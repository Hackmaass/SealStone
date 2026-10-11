import { useCallback, useEffect, useMemo, useState } from "react";
import { keccak256, toUtf8Bytes } from "ethers";
import { navigate } from "../../lib/router";
import { useApp } from "../../lib/app";
import { ACCOUNT_ROLES, accountAddress, deployment, provider, signerAt, vaultContract } from "../../lib/chain";
import { useVault } from "../../lib/useVault";
import { useTx } from "../../lib/useTx";
import { loadAttempts, saveAttempts } from "../../lib/attempts";
import { partiesOf, sendersSnapshot, type VaultSnapshot } from "../../lib/vaultData";
import { loadTerms, type TermsCheck } from "../../lib/terms";
import { saveNote } from "../../lib/notes";
import { formatRawError, type DecodedRevert } from "../../lib/revert";
import {
  AGREEMENT_NAMES,
  buildTimeline,
  nextStep,
  roleOfAddress,
  withdrawPlan,
  type ActionId,
  type Attempt,
  type VaultRole,
} from "../../lib/vaultModel";
import type { HashedFile } from "../../lib/files";
import { Amount, HashSeal, HashText } from "../../ui/components";
import { formatWei } from "../../ui/copy";
import { LedgerPanel } from "../../ui/LedgerPanel";
import { Timeline } from "../../ui/Timeline";
import { useToast } from "../../ui/toast";
import { MilestoneRow } from "./MilestoneRow";
import { ApproveSheet, ReasonSheet, SubmitSheet, useNote } from "./Sheets";
import { TermsBadge, TermsPanel } from "./TermsPanel";

const PROBE = keccak256(toUtf8Bytes("try-anyway probe"));
const ROLE_NAME: Record<VaultRole, string> = { client: "Client", provider: "Provider", arbiter: "Arbiter", stranger: "Stranger" };

type Sheet = { kind: "submit" | "approve" | "dispute" | "release" | "refund"; index: number } | null;

export function VaultPage({ address }: { address: string }) {
  const { load, refresh } = useVault(address);
  if (load.status === "loading") {
    return (
      <div className="panel vault-note" aria-busy="true">
        <h1>Vault</h1>
        <p className="muted">Reading the chain…</p>
      </div>
    );
  }
  if (load.status === "missing") {
    return (
      <div className="panel vault-note">
        <h1>No vault at this address</h1>
        <p className="mono small muted">{address}</p>
        <p>The local chain may have been reset since this vault was created. Draft a new agreement or open the demo vault.</p>
        <div className="actions">
          <button className="btn go" type="button" onClick={() => navigate(`/vault/${deployment.preseededVault.address}`)}>Open the demo vault</button>
          <button className="btn secondary" type="button" onClick={() => navigate("/agreement")}>Draft a new agreement</button>
        </div>
      </div>
    );
  }
  if (load.status === "error") {
    return (
      <div className="panel vault-note" role="alert">
        <h1>Couldn't read this vault</h1>
        <p className="muted">{load.message}</p>
        <button className="btn" type="button" onClick={() => void refresh()}>Try again</button>
      </div>
    );
  }
  return <VaultView address={address} snapshot={load.snapshot} refresh={refresh} />;
}

function VaultView({ address, snapshot: s, refresh }: { address: string; snapshot: VaultSnapshot; refresh: () => Promise<void> }) {
  const app = useApp();
  const { toast } = useToast();

  // The chain's own clock, ticking once a second between blocks (so countdowns move and Escalate unlocks on time).
  const [wall, setWall] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setWall(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const chainNow = BigInt(wall + s.clockOffset);

  // ───── the confirmed terms, checked against the chain ─────
  const [terms, setTerms] = useState<TermsCheck | null>(null);
  const [checking, setChecking] = useState(true);
  const recheck = useCallback(() => {
    setChecking(true);
    void loadTerms(s.agreementHash).then((t) => {
      setTerms(t);
      setChecking(false);
    });
  }, [s.agreementHash]);
  useEffect(recheck, [recheck]);

  const checklist = terms && (terms.kind === "verified" || terms.kind === "mismatch") ? terms.checklist : null;
  // Only terms that match the seal may name the people. Anything else would be a name nobody signed.
  const trusted = terms?.kind === "verified" ? terms.checklist : null;
  const names = useMemo(
    () => ({ client: trusted?.parties.client.name ?? "the client", provider: trusted?.parties.provider.name ?? "the provider", arbiter: trusted?.parties.arbiter.name ?? "the arbiter" }),
    [trusted],
  );
  useEffect(() => {
    if (trusted) app.setNames({ client: trusted.parties.client.name, provider: trusted.parties.provider.name, arbiter: trusted.parties.arbiter.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trusted]);

  // ───── who am I in THIS vault? Decided by address, not by which tab is lit ─────
  const myAddress = accountAddress(app.role);
  const parties = useMemo(() => partiesOf(s, names), [s, names]);
  const vaultRole: VaultRole = roleOfAddress(parties, myAddress);

  // ───── rejected attempts (kept per vault, shown in the timeline) ─────
  const [attempts, setAttempts] = useState<Attempt[]>(() => loadAttempts(address, s.epoch));
  useEffect(() => {
    // The chain was reset (same address, new life): old refusals belong to a vault that no longer exists.
    setAttempts(loadAttempts(address, s.epoch));
    setReject(null);
  }, [address, s.epoch]);
  const [reject, setReject] = useState<{ index: number | null; d: DecodedRevert } | null>(null);
  const [shake, setShake] = useState<number | null>(null);
  const onRejected = useCallback(
    (d: DecodedRevert, label: string) => {
      const [action, idx] = label.split(":");
      const index = idx === "-" || idx === undefined ? null : Number(idx);
      setReject({ index, d });
      if (index !== null) setShake(index);
      setAttempts((cur) => {
        const next = [...cur, { id: `a${Date.now()}-${cur.length}`, block: s.block, seq: cur.length, role: vaultRole, actor: myAddress, action, errorName: d.name, title: d.title, raw: formatRawError(d) }];
        saveAttempts(address, s.epoch, next);
        return next;
      });
    },
    [address, myAddress, s.block, s.epoch, vaultRole],
  );
  // A refusal belongs to whoever caused it: switching accounts must not leave it looking like the new account's error.
  useEffect(() => {
    setReject(null);
  }, [app.role]);
  const tx = useTx(vaultRole === "stranger" ? "a stranger" : ROLE_NAME[vaultRole].toLowerCase(), onRejected);

  const [sheet, setSheet] = useState<Sheet>(null);
  const closeSheet = () => setSheet(null);

  /** Sends one real transaction as the current account. A refusal is shown in place; nothing is faked. */
  const act = useCallback(
    (id: string, index: number | null, fn: (c: ReturnType<typeof vaultContract>) => Promise<{ wait: () => Promise<unknown> }>, success: string): Promise<boolean> =>
      tx.run(`${id}:${index ?? "-"}`, async () => {
        setReject(null);
        const signer = await signerAt(myAddress);
        const sent = await fn(vaultContract(address, signer));
        await sent.wait();
        toast(success);
      }).then(async (ok) => {
        closeSheet(); // a refusal shows in the row behind the sheet, so close it either way
        await refresh();
        return ok;
      }),
    [tx, myAddress, address, toast, refresh],
  );

  const milestoneTitle = (i: number) => checklist?.milestones[i]?.title ?? `milestone ${i + 1}`;

  const doSubmit = (i: number, f: HashedFile) => act("markComplete", i, (c) => c.markComplete(i, f.hash), `Work submitted. ${names.client === "the client" ? "The client" : names.client} can now review it.`);
  const doApprove = (i: number, f: HashedFile) =>
    act("approve", i, (c) => c.approve(i, f.hash), `Released ${formatWei(s.milestones[i].amount)} ETH to ${names.provider}`);
  const doDispute = async (i: number, text: string, hash: string) => {
    const ok = await act("dispute", i, (c) => c.dispute(i, hash), "Sent to the arbiter");
    if (ok) await saveNote(hash, text);
  };
  const doResolve = async (i: number, ruling: 0 | 1, text: string, hash: string) => {
    const amt = formatWei(s.milestones[i].amount);
    const ok = await act(ruling === 0 ? "release" : "refund", i, (c) => c.resolve(i, ruling, hash), ruling === 0 ? `Released ${amt} ETH to ${names.provider}` : `Refunded ${amt} ETH to ${names.client}`);
    if (ok) await saveNote(hash, text);
  };
  const doEscalate = (i: number) => act("escalate", i, (c) => c.escalate(i), "Sent to the arbiter");
  const doWithdraw = () => act("withdraw", null, (c) => c.withdraw(), "Withdrawn");

  /** "Try anyway": the REAL call, from the current account, so the contract's refusal is what the audience sees. */
  const tryAnyway = (id: ActionId, i: number) => {
    const m = s.milestones[i];
    switch (id) {
      case "markComplete":
        return act("markComplete", i, (c) => c.markComplete(i, PROBE), "");
      case "approve":
        return act("approve", i, (c) => c.approve(i, m.deliverableHash), "");
      case "dispute":
        return act("dispute", i, (c) => c.dispute(i, PROBE), "");
      case "escalate":
        return act("escalate", i, (c) => c.escalate(i), "");
      case "release":
        return act("release", i, (c) => c.resolve(i, 0, PROBE), "");
      case "refund":
        return act("refund", i, (c) => c.resolve(i, 1, PROBE), "");
    }
  };
  const onOffer = (id: ActionId, i: number) => {
    if (id === "escalate") void doEscalate(i);
    else setSheet({ kind: id === "markComplete" ? "submit" : id, index: i });
  };

  const skipTime = async (seconds: bigint) => {
    try {
      await provider.send("evm_increaseTime", [Number(seconds)]);
      await provider.send("evm_mine", []);
      toast("The local chain's clock moved forward. The review window has ended.");
    } catch {
      toast("The chain didn't accept the time change. This control only works on the local test chain.", true);
    }
    await refresh();
  };

  // ───── derived ─────
  const credit = vaultRole === "client" ? s.credits.client : vaultRole === "provider" ? s.credits.provider : 0n;
  const wp = withdrawPlan(vaultRole, credit);
  const step = nextStep({ role: vaultRole, agreementState: s.agreementState, nextMilestone: s.nextMilestone, milestones: s.milestones, credits: s.credits, reviewWindow: s.reviewWindow, chainNow });
  const timeline = useMemo(() => buildTimeline(s.events, sendersSnapshot(), parties, attempts), [s.events, parties, attempts]);
  const closed = s.agreementState === 3;
  const tabFor = (addr: string) => ACCOUNT_ROLES.findIndex((r) => accountAddress(r).toLowerCase() === addr.toLowerCase());
  const actorTab = step.actor && step.actor !== "stranger" ? tabFor(s.addresses[step.actor]) : -1;
  const ledgerLabels = { client: "the client", provider: "the provider" };
  const stateWord = AGREEMENT_NAMES[s.agreementState] ?? "Unknown";
  const sheetMilestone = sheet ? s.milestones[sheet.index] : null;
  const busyAct = tx.busy;

  return (
    <div className="vault-page" data-vault-state={stateWord}>
      <section className="panel vheadbox">
        <div className="vhead-in">
        <HashSeal hash={s.agreementHash} state="onchain" size={48} draw />
        <div className="title">
          <h1>{trusted?.title ?? "Escrow vault"}</h1>
          <div className="facts">
            <span className="f"><b>{names.client}</b> <span className="muted small">Client</span></span>
            <span className="f"><b>{names.provider}</b> <span className="muted small">Provider</span></span>
            <span className="f"><b>{names.arbiter}</b> <span className="muted small">Arbiter</span></span>
          </div>
          <div className="facts" style={{ marginTop: 6 }}>
            <span className="f">Total <Amount wei={s.total} /></span>
            <span className="f">Seal <HashText hash={s.agreementHash} /></span>
            <span className="f"><TermsBadge terms={terms} checking={checking} /></span>
          </div>
        </div>
        <span className={`chip ${closed ? "onchain" : s.agreementState === 2 ? "human" : "proposed"}`} data-testid="agreement-state">{stateWord}</span>
        </div>
        <TermsPanel onChainHash={s.agreementHash} terms={terms} onRecheck={recheck} />
      </section>

      <section className={`panel yourmove${step.mine ? " mine" : ""}`} aria-live="polite" data-testid="your-move">
        <div>
          <p className="yourmove-head">{step.headline}</p>
          {step.detail && <p className="muted small">{step.detail}</p>}
          <p className="muted small">
            You're acting as <b>{app.names[app.role]}</b>
            {vaultRole === "stranger" ? ", who isn't part of this agreement here. You can look around, and anything you try will be refused." : `, the ${ROLE_NAME[vaultRole].toLowerCase()} of this vault.`}
          </p>
        </div>
        {step.actor && !step.mine && actorTab >= 0 && (
          <button className="btn secondary" type="button" onClick={() => app.setRoleIdx(actorTab)}>
            Switch to the {ROLE_NAME[step.actor].toLowerCase()} <span className="kbd">{actorTab + 1}</span>
          </button>
        )}
      </section>

      {s.agreementState < 2 && (
        <div className="banner" role="status" style={{ borderRadius: 8, marginBottom: 16 }}>
          {s.agreementState === 0 ? "This vault is still waiting for signatures." : "This vault is signed but not funded yet."} Finish in the agreement studio.{" "}
          <button className="linklike" type="button" onClick={() => navigate("/agreement")}>Continue there</button>
        </div>
      )}
      {closed && (
        <div className="banner done" role="status" style={{ borderRadius: 8, marginBottom: 16 }}>
          All milestones are settled. <Amount wei={s.reconcile.heldInEscrow} /> is left in escrow.
          {s.credits.client + s.credits.provider > 0n && " Some money is still waiting to be withdrawn."}
        </div>
      )}

      <div className="vgrid">
        <div>
          <section className="panel ms" aria-label="Milestones">
            {s.milestones.map((m) => {
              const t = checklist?.milestones[m.index];
              return (
                <MilestoneRow
                  key={m.index}
                  m={m}
                  terms={t ? { title: t.title, conditions: t.conditions, deadline: t.deadline } : null}
                  role={vaultRole}
                  agreementState={s.agreementState}
                  nextMilestone={s.nextMilestone}
                  reviewWindow={s.reviewWindow}
                  chainNow={chainNow}
                  names={names}
                  busy={busyAct}
                  reject={reject && reject.index === m.index ? reject.d : null}
                  shake={shake === m.index}
                  onShakeEnd={() => setShake(null)}
                  onOffer={(id) => onOffer(id, m.index)}
                  onTry={(id) => void tryAnyway(id, m.index)}
                  onSkipTime={(secs) => void skipTime(secs)}
                />
              );
            })}
          </section>
          <Timeline entries={timeline} />
        </div>

        <aside className="rail-col">
          <LedgerPanel r={s.reconcile} block={s.block} labels={ledgerLabels} />
          <section className="panel withdraw" aria-label="Withdraw">
            <h2>Your balance</h2>
            {wp.enabled ? (
              <>
                <p className="muted small">{names[vaultRole === "client" ? "client" : "provider"]} is owed <Amount wei={credit} />. Money is only sent when its owner asks for it.</p>
                <button className="btn go" type="button" data-action="withdraw" disabled={busyAct !== null} onClick={() => void doWithdraw()}>
                  {busyAct?.startsWith("withdraw") ? "Waiting for block…" : wp.label}
                </button>
              </>
            ) : (
              <>
                <p className="muted small">{wp.reason}</p>
                <div className="actions">
                  <button className="btn secondary" type="button" disabled title={wp.reason}>Withdraw</button>
                  <details className="try">
                    <summary>Try anyway</summary>
                    <div className="menu">
                      <button type="button" data-try="withdraw" disabled={busyAct !== null} onClick={() => void doWithdraw()}>
                        Withdraw
                        <small>{vaultRole === "arbiter" ? "The arbiter can never be paid" : "Nothing is owed to this account"}</small>
                      </button>
                    </div>
                  </details>
                </div>
              </>
            )}
            {reject && reject.index === null && (
              <div className="revert" role="alert" style={{ marginTop: 10 }}>
                <b>{reject.d.title}.</b> {reject.d.detail} Nothing changed.
                <div className="raw">{formatRawError(reject.d)}</div>
              </div>
            )}
          </section>
        </aside>
      </div>

      <SubmitSheet
        open={sheet?.kind === "submit"}
        index={sheet?.index ?? 0}
        title={milestoneTitle(sheet?.index ?? 0)}
        busy={busyAct?.startsWith("markComplete") ?? false}
        onClose={closeSheet}
        onSend={(f) => void doSubmit(sheet!.index, f)}
      />
      <ApproveSheet
        open={sheet?.kind === "approve" && !!sheetMilestone}
        index={sheet?.index ?? 0}
        amount={sheetMilestone?.amount ?? 0n}
        providerName={names.provider}
        submittedHash={sheetMilestone?.deliverableHash ?? "0x"}
        busy={busyAct?.startsWith("approve") ?? false}
        onClose={closeSheet}
        onSend={(f) => void doApprove(sheet!.index, f)}
      />
      <ReasonSheet
        open={sheet?.kind === "dispute"}
        title={`Dispute milestone ${(sheet?.index ?? 0) + 1}`}
        intro={<p>{names.arbiter} will decide whether to release the funds or refund them. Your reason is sealed and recorded, so neither side can rewrite it later.</p>}
        label="What's wrong with the delivery?"
        placeholder="For example: the app only recognised 1 of the 3 sample diseases in our test."
        sendLabel="Send to the arbiter"
        busy={busyAct?.startsWith("dispute") ?? false}
        onClose={closeSheet}
        onSend={(text, hash) => void doDispute(sheet!.index, text, hash)}
      />
      <ReasonSheet
        open={sheet?.kind === "release" || sheet?.kind === "refund"}
        title={sheet?.kind === "refund" ? `Refund milestone ${(sheet?.index ?? 0) + 1} to ${names.client}` : `Release milestone ${(sheet?.index ?? 0) + 1} to ${names.provider}`}
        intro={<p>This settles the dispute and can't be undone. Your reasoning is sealed on the chain next to the ruling.</p>}
        context={sheet ? <DisputeContext s={s} index={sheet.index} checklistConditions={checklist?.milestones[sheet.index]?.conditions ?? []} /> : null}
        label="Why this ruling?"
        placeholder="Explain what you checked and why you decided this way."
        sendLabel={sheet?.kind === "refund" ? `Refund ${formatWei(sheetMilestone?.amount ?? 0n)} ETH` : `Release ${formatWei(sheetMilestone?.amount ?? 0n)} ETH`}
        busy={busyAct?.startsWith("release") || busyAct?.startsWith("refund") || false}
        onClose={closeSheet}
        onSend={(text, hash) => void doResolve(sheet!.index, sheet!.kind === "refund" ? 1 : 0, text, hash)}
      />
    </div>
  );
}

/** Shown to the arbiter inside the ruling sheet: what was agreed, next to what the client said. */
function DisputeContext({ s, index, checklistConditions }: { s: VaultSnapshot; index: number; checklistConditions: string[] }) {
  const m = s.milestones[index];
  const zero = /^0x0*$/.test(m.evidenceHash);
  const note = useNote(m.evidenceHash);
  return (
    <div className="dispute-context">
      {checklistConditions.length > 0 && (
        <>
          <b className="small">What was agreed</b>
          <ul>
            {checklistConditions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
      <p className="small">
        <b>The client's reason:</b>{" "}
        {zero ? <span className="muted">none. The provider escalated after the review window.</span> : note && note !== "loading" ? <q>{note}</q> : <span className="muted">sealed on the chain; the text isn't stored here.</span>}
      </p>
    </div>
  );
}
