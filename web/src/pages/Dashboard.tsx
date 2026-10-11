import { useMemo, type ReactNode } from "react";
import { useApp } from "../lib/app";
import { ACCOUNT_ROLES, accountAddress, deployment } from "../lib/chain";
import { navigate } from "../lib/router";
import { totalsOf, type VaultSummary } from "../lib/vaultList";
import { useVaultList } from "../lib/useVaultList";
import { AGREEMENT_NAMES, nextStep, roleOfAddress, withdrawPlan, type NextStep } from "../lib/vaultModel";
import { Amount, HashSeal, ROLE_LABEL, type Role } from "../ui/components";
import { formatWei, shortHash } from "../ui/copy";
import { VaultTableSkeleton, vaultName } from "../ui/VaultTable";

interface Attention {
  vault: VaultSummary;
  headline: string;
  /** the milestone this is about, when there is one */
  milestone: { number: number; amount: bigint } | null;
  kind: "move" | "withdraw";
}

const sentence = (s: string): string => s.replace(/^Your move: /, "").replace(/^./, (c) => c.toUpperCase());
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the vault's current step means for the given account, read from the chain-derived summary (never stored). */
function stepFor(v: VaultSummary, me: string): { step: NextStep; withdraw: ReturnType<typeof withdrawPlan>; role: ReturnType<typeof roleOfAddress> } {
  const parties = { client: { name: "", address: v.parties.client }, provider: { name: "", address: v.parties.provider }, arbiter: { name: "", address: v.parties.arbiter } };
  const role = roleOfAddress(parties, me);
  const step = nextStep({ role, agreementState: v.agreementState, nextMilestone: v.nextMilestone, milestones: v.milestones, credits: v.credits, reviewWindow: 0n, chainNow: 0n });
  const credit = role === "client" ? v.credits.client : role === "provider" ? v.credits.provider : 0n;
  return { step, withdraw: withdrawPlan(role, credit), role };
}

/** What is waiting on one account, across every vault. */
function attentionFor(list: VaultSummary[], me: string): Attention[] {
  const out: Attention[] = [];
  for (const v of list) {
    const { step, withdraw, role } = stepFor(v, me);
    if (role === "stranger") continue;
    const m = v.agreementState === 2 ? v.milestones[v.nextMilestone] : undefined;
    const milestone = m ? { number: m.index + 1, amount: m.amount } : null;
    if (step.mine) out.push({ vault: v, headline: sentence(step.headline), milestone, kind: "move" });
    else if (withdraw.enabled) out.push({ vault: v, headline: "You have money to withdraw.", milestone: null, kind: "withdraw" });
  }
  return out;
}

const Icon = ({ children }: { children: ReactNode }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

/** An ETH figure split so the unit can sit quieter than the number. */
const Figure = ({ wei }: { wei: bigint }) => (
  <>
    {formatWei(wei, 3)}
    <span className="unit"> ETH</span>
  </>
);

/** Share of `whole` as a percentage with two decimals, from bigints (never floats of wei). */
const pct = (part: bigint, whole: bigint): number => (whole === 0n ? 0 : Number((part * 10000n) / whole) / 100);

type Flow = { deposited: bigint; released: bigint; refunded: bigint; withdrawn: bigint };
type Totals = ReturnType<typeof totalsOf>;

/**
 * THE HEADER BAND: who you are, what is next, and the money in four numbers. The three amounts split every deposited wei into
 * in escrow / ready to withdraw / withdrawn (the same split the bar below draws), and the last number is the ledger verdict.
 */
function Band({ ready, totals, list, flow, headline, who, actions }: { ready: boolean; totals: Totals; list: VaultSummary[]; flow: Flow; headline: string; who: string; actions: ReactNode }) {
  const bad = ready && list.length > 0 && !totals.allReconciled;
  const verdict = !ready ? "Checking…" : list.length === 0 ? "Nothing yet" : totals.allReconciled ? "✓ All reconcile" : "✕ Check a vault";
  return (
    <header className="dband" data-testid="dash-stats">
      <div className="dband-main">
        <div className="dhead-title">
          <h1>Dashboard</h1>
          <p className="dhead-who">
            <span className="dhead-dot" aria-hidden="true" />
            {who}
          </p>
        </div>
        <p className="dhead-sub" data-testid="dash-headline">{headline}</p>
        <div className="dhead-actions">{actions}</div>
      </div>
      <dl className="dband-metrics">
        <div className="m escrow">
          <dt><span className="sw" aria-hidden="true" />In escrow now</dt>
          <dd className="big" data-testid="hero-escrow">{ready ? <Figure wei={totals.inEscrow} /> : <span className="sk hero-sk" aria-hidden="true" />}</dd>
          <dd className="h">
            {ready ? (
              <>
                <b data-testid="stat-vaults">{totals.vaults}</b> {totals.vaults === 1 ? "vault" : "vaults"}, {totals.active} active
              </>
            ) : (
              "reading the chain"
            )}
          </dd>
        </div>
        <div className="m owed">
          <dt><span className="sw" aria-hidden="true" />Ready to withdraw</dt>
          <dd className="big">{ready ? <Figure wei={totals.owed} /> : "—"}</dd>
          <dd className="h">released or refunded</dd>
        </div>
        <div className="m gone">
          <dt><span className="sw" aria-hidden="true" />Withdrawn</dt>
          <dd className="big">{ready ? <Figure wei={flow.withdrawn} /> : "—"}</dd>
          <dd className="h">already paid out</dd>
        </div>
        <div className={`m proof${bad ? " bad" : ""}`}>
          <dt>Ledgers</dt>
          <dd className="big verdict" data-testid="stat-ledgers">{verdict}</dd>
          <dd className="h">checked after every move</dd>
        </div>
      </dl>
    </header>
  );
}

/** The balance equation the contract enforces, drawn as one bar (same colours as the swatches in the header band). */
function LedgerStrip({ ready, totals, list, flow }: { ready: boolean; totals: Totals; list: VaultSummary[]; flow: Flow }) {
  const parts = [
    { key: "escrow", label: "In escrow", wei: totals.inEscrow },
    { key: "owed", label: "Ready to withdraw", wei: totals.owed },
    { key: "gone", label: "Withdrawn", wei: flow.withdrawn },
  ];
  const sum = parts.reduce((t, p) => t + p.wei, 0n);
  const balance = list.reduce((t, v) => t + v.reconcile.actualBalance, 0n);
  return (
    <section className="dstrip" aria-label="Balance check">
      <span className="dstrip-ic" aria-hidden="true">
        <Icon><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5L16 9.5" /></Icon>
      </span>
      <div className="dstrip-body">
        <p className="dstrip-t">The balance always reconciles</p>
        <p className="dstrip-s">
          {ready && list.length > 0 ? (
            <>
              Contract balance <Amount wei={balance} /> = deposited <Amount wei={flow.deposited} /> − withdrawn <Amount wei={flow.withdrawn} />. Simulated funds on a local chain.
            </>
          ) : (
            "The contract checks deposits minus payouts against its real balance after every move."
          )}
        </p>
        <div className="dstrip-bar" role="img" aria-label={ready && sum > 0n ? parts.map((p) => `${p.label} ${formatWei(p.wei, 3)} ETH`).join(", ") : "No funds yet"}>
          {ready && sum > 0n ? parts.map((p) => p.wei > 0n && <span key={p.key} className={`seg ${p.key}`} style={{ width: `${pct(p.wei, sum)}%` }} />) : <span className="seg none" />}
        </div>
      </div>
    </section>
  );
}

const SEGMENT: Record<string, string> = { Pending: "pending", Completed: "proposed", Disputed: "revert", Released: "onchain", Refunded: "human" };

/** One vault as a table row: its seal, one segment per milestone (state also in words), the money and its ledger verdict, whose move it is. */
function VaultRow({ v, me }: { v: VaultSummary; me: string }) {
  const { step, role } = stepFor(v, me);
  const open = () => navigate(`/vault/${v.address}`);
  return (
    <li>
      <article
        className="vrow"
        data-vault={v.address}
        tabIndex={0}
        aria-label={`${vaultName(v)}, ${AGREEMENT_NAMES[v.agreementState] ?? ""}. ${sentence(step.headline)}`}
        onClick={open}
        onKeyDown={(e) => e.key === "Enter" && open()}
      >
        <HashSeal hash={v.agreementHash} state="onchain" size={40} />
        <div className="vrow-id">
          <b>{vaultName(v)}</b>
          <span className="muted small mono">{shortHash(v.address)}</span>
        </div>
        <div className="vrow-prog">
          <ol className="segs" aria-label="Milestones">
            {v.milestones.map((m) => (
              <li key={m.index} className={`segm ${SEGMENT[m.state] ?? "pending"}`} title={`Milestone ${m.index + 1}: ${m.state}`}>
                <span className="sr-only">Milestone {m.index + 1}: {m.state}</span>
              </li>
            ))}
          </ol>
          <span className="muted small">{v.settled} of {v.milestones.length} settled · {AGREEMENT_NAMES[v.agreementState] ?? "Unknown"}</span>
        </div>
        <div className="vrow-money">
          <Amount wei={v.reconcile.heldInEscrow} />
          <span className={`small vrow-ledger ${v.reconcile.ok ? "ok" : "bad"}`}>{v.reconcile.ok ? "✓ Reconciled" : "✕ Not reconciled"}</span>
        </div>
        <p className={`vrow-next${step.mine ? " mine" : ""}`}>
          {step.mine ? <span className="tag">Your move</span> : <span className="tag quiet">{role === "stranger" ? "Next" : "Waiting"}</span>}
          <span>{sentence(step.headline)}</span>
        </p>
        <button
          type="button"
          className={`btn vrow-open ${step.mine ? "go" : "secondary"}`}
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
        >
          {step.mine ? "Open vault" : "Open"}
        </button>
      </article>
    </li>
  );
}

export function Dashboard() {
  const app = useApp();
  const { state, refresh } = useVaultList();
  const me = accountAddress(app.role);
  const list = useMemo(() => (state.status === "ready" ? state.list : []), [state]);
  const ready = state.status === "ready";
  const totals = useMemo(() => totalsOf(list), [list]);
  const attention = useMemo(() => attentionFor(list, me), [list, me]);
  // How many things wait on each account, so we can say where the next move is when it is not here.
  const counts = useMemo(() => ACCOUNT_ROLES.map((r) => attentionFor(list, accountAddress(r)).length), [list]);
  const flow: Flow = useMemo(
    () => list.reduce((s, v) => ({ deposited: s.deposited + v.reconcile.deposited, released: s.released + v.reconcile.released, refunded: s.refunded + v.reconcile.refunded, withdrawn: s.withdrawn + v.reconcile.withdrawn }), { deposited: 0n, released: 0n, refunded: 0n, withdrawn: 0n }),
    [list],
  );
  const elsewhere = counts.findIndex((n, i) => n > 0 && i !== app.roleIdx);
  const myRole = ROLE_LABEL[app.role as Role] ?? "";

  const headline = !ready
    ? "Reading the chain…"
    : attention.length > 0
      ? `${plural(attention.length, "thing")} ${attention.length === 1 ? "needs" : "need"} your move.`
      : list.length === 0
        ? "No vaults yet. Draft an agreement to create one."
        : "You're all caught up.";

  return (
    <div className="dash">
      <Band
        ready={ready}
        totals={totals}
        list={list}
        flow={flow}
        headline={headline}
        who={`${app.names[app.role]}${myRole ? ` · ${myRole}` : ""}`}
        actions={
          <>
            <button className="btn go" type="button" onClick={() => navigate("/agreement")}>Draft an agreement</button>
            <button className="btn secondary" type="button" onClick={() => navigate(`/vault/${deployment.preseededVault.address}`)}>Open the demo vault</button>
          </>
        }
      />

      <LedgerStrip ready={ready} totals={totals} list={list} flow={flow} />

      <section className="dpanel" aria-label="Waiting on you">
        <div className="dpanel-head">
          <h2>
            Needs your move
            {ready && attention.length > 0 && <span className="count" aria-label={`${attention.length} waiting`}>{attention.length}</span>}
          </h2>
          {ready && elsewhere >= 0 && attention.length > 0 && (
            <button className="linklike small" type="button" onClick={() => app.setRoleIdx(elsewhere)}>
              {app.names[ACCOUNT_ROLES[elsewhere]]} has {counts[elsewhere]} · switch
            </button>
          )}
        </div>

        {state.status === "loading" && <VaultTableSkeleton />}
        {state.status === "error" && (
          <div className="empty" role="alert">
            <p>Couldn't read the chain.</p>
            <p className="muted small">
              {state.message}. Is it running? <code>npm run chain</code>
            </p>
            <button className="btn secondary" type="button" style={{ marginTop: 10 }} onClick={refresh}>Try again</button>
          </div>
        )}
        {ready && attention.length === 0 && (
          <div className="allclear">
            <span className="allclear-ic" aria-hidden="true"><Icon><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon></span>
            <div className="allclear-t">
              <p><b>You're all caught up.</b></p>
              <p className="muted small">
                {list.length === 0
                  ? "There are no vaults yet."
                  : elsewhere >= 0
                    ? `Nothing is waiting on ${app.names[app.role]}. ${app.names[ACCOUNT_ROLES[elsewhere]]} has ${plural(counts[elsewhere], "thing")} to do.`
                    : `Nothing is waiting on ${app.names[app.role]} right now.`}
              </p>
            </div>
            {elsewhere >= 0 && list.length > 0 && (
              <button className="btn secondary" type="button" onClick={() => app.setRoleIdx(elsewhere)}>
                Switch to {app.names[ACCOUNT_ROLES[elsewhere]]}
              </button>
            )}
          </div>
        )}
        {attention.length > 0 && (
          <ul className="attention" data-testid="attention">
            {attention.map((a) => (
              <li key={a.vault.address + a.kind}>
                <span className={`att-ic ${a.kind}`} aria-hidden="true">{a.kind === "move" ? "→" : "↓"}</span>
                <div className="att-body">
                  <span className="att-title">
                    <b>{vaultName(a.vault)}</b> <span className="muted small mono">{shortHash(a.vault.address)}</span>
                  </span>
                  <span>{a.headline}</span>
                  {a.milestone && (
                    <span className="muted small">
                      Milestone {a.milestone.number} · <Amount wei={a.milestone.amount} />
                    </span>
                  )}
                </div>
                <button className="btn go" type="button" onClick={() => navigate(`/vault/${a.vault.address}`)}>{a.kind === "move" ? "Open vault" : "Withdraw"}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dpanel" aria-label="Your vaults">
        <div className="dpanel-head">
          <h2>
            Vaults
            {ready && list.length > 0 && <span className="muted small dpanel-n">{list.length}</span>}
          </h2>
          <button className="linklike small" type="button" onClick={() => navigate("/vaults")}>See all vaults</button>
        </div>
        {state.status === "loading" && <VaultTableSkeleton />}
        {ready && list.length === 0 && (
          <div className="empty">
            <p>No agreements yet.</p>
            <p className="muted small">Draft one from text, or open the demo vault.</p>
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn go" type="button" onClick={() => navigate("/agreement")}>Draft an agreement</button>
              <button className="btn secondary" type="button" onClick={() => navigate(`/vault/${deployment.preseededVault.address}`)}>Open the demo vault</button>
            </div>
          </div>
        )}
        {ready && list.length > 0 && (
          <>
            <div className="vthead" aria-hidden="true">
              <span className="c-id">Agreement</span>
              <span className="c-prog">Progress</span>
              <span className="c-money">In escrow</span>
              <span className="c-next">Next step</span>
            </div>
            <ul className="vrows">
              {list.slice(0, 5).map((v) => (
                <VaultRow key={v.address} v={v} me={me} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="dlab" aria-label="Attack Lab">
        <span className="dlab-art" aria-hidden="true">
          <svg viewBox="0 0 96 96" width="44" height="44">
            <circle cx="48" cy="48" r="30" fill="none" stroke="currentColor" strokeWidth="3" />
            <circle cx="48" cy="48" r="9" fill="currentColor" />
            {Array.from({ length: 24 }, (_, i) => {
              const a = (i / 24) * Math.PI * 2;
              const r2 = 38 + (i % 5) * 2;
              return <line key={i} x1={48 + 33 * Math.cos(a)} y1={48 + 33 * Math.sin(a)} x2={48 + r2 * Math.cos(a)} y2={48 + r2 * Math.sin(a)} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />;
            })}
          </svg>
        </span>
        <div className="dlab-t">
          <h2>Try to break it</h2>
          <p className="muted small">Fire 12 real attacks at a sandbox vault, including a re-entrancy attack that drains a naive escrow.</p>
        </div>
        <button className="btn secondary" type="button" onClick={() => navigate("/attack-lab")}>Open the Attack Lab</button>
      </section>

      <p className="dkeys muted small">
        Shortcuts: <kbd>1</kbd>–<kbd>4</kbd> act as someone else · <kbd>T</kbd> light or dark · <kbd>P</kbd> presenter mode
      </p>
    </div>
  );
}
