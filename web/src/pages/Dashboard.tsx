import { useMemo, type ReactNode } from "react";
import { useApp } from "../lib/app";
import { ACCOUNT_ROLES, accountAddress, deployment } from "../lib/chain";
import { navigate } from "../lib/router";
import { totalsOf, type VaultSummary } from "../lib/vaultList";
import { useVaultList } from "../lib/useVaultList";
import { AGREEMENT_NAMES, nextStep, roleOfAddress, withdrawPlan, type NextStep } from "../lib/vaultModel";
import { Amount, ROLE_LABEL, StateBadge, type Role } from "../ui/components";
import { shortHash } from "../ui/copy";
import { VaultTableSkeleton, vaultName } from "../ui/VaultTable";

const STATE_CHIP = ["pending", "proposed", "human", "onchain"] as const;
const STATE_ICON = ["✎", "◌", "◉", "✓"] as const;

interface Attention {
  vault: VaultSummary;
  headline: string;
  /** the milestone this is about, when there is one */
  milestone: { number: number; amount: bigint } | null;
  kind: "move" | "withdraw";
}

const sentence = (s: string): string => s.replace(/^Your move: /, "").replace(/^./, (c) => c.toUpperCase());

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
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

function Stat({ icon, label, value, hint, testid, tone }: { icon: ReactNode; label: string; value: ReactNode; hint: string; testid?: string; tone?: "ok" | "bad" }) {
  return (
    <div className={`dstat${tone ? ` ${tone}` : ""}`}>
      <span className="dstat-ic">{icon}</span>
      <div>
        <div className="dstat-k">{label}</div>
        <div className="dstat-v" data-testid={testid}>{value}</div>
        <div className="dstat-h">{hint}</div>
      </div>
    </div>
  );
}

/** One vault: what it is, whose move it is, every milestone at a glance (icon + word, never colour alone), and the money. */
function VaultCard({ v, me }: { v: VaultSummary; me: string }) {
  const { step, role } = stepFor(v, me);
  const open = () => navigate(`/vault/${v.address}`);
  return (
    <article className="vcard" data-vault={v.address} tabIndex={0} aria-label={`${vaultName(v)}, ${AGREEMENT_NAMES[v.agreementState] ?? ""}`} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()}>
      <header className="vcard-head">
        <div className="vcard-title">
          <b>{vaultName(v)}</b>
          <span className="muted small mono">{shortHash(v.address)}</span>
        </div>
        <span className={`chip ${STATE_CHIP[v.agreementState] ?? "pending"}`}>
          <span aria-hidden="true">{STATE_ICON[v.agreementState] ?? "·"}</span>
          {AGREEMENT_NAMES[v.agreementState] ?? "Unknown"}
        </span>
      </header>

      <p className={`vcard-next${step.mine ? " mine" : ""}`}>
        {step.mine ? <span className="tag">Your move</span> : <span className="tag quiet">{role === "stranger" ? "Next" : "Waiting"}</span>}
        <span>{sentence(step.headline)}</span>
      </p>

      <ol className="vcard-ms" aria-label="Milestones">
        {v.milestones.map((m) => (
          <li key={m.index}>
            <span className="small muted">Milestone {m.index + 1}</span>
            <Amount wei={m.amount} />
            <StateBadge state={m.state} />
          </li>
        ))}
      </ol>

      <footer className="vcard-foot">
        <dl>
          <div><dt>In escrow</dt><dd><Amount wei={v.reconcile.heldInEscrow} /></dd></div>
          <div><dt>Owed</dt><dd><Amount wei={v.reconcile.owedToParties} /></dd></div>
          <div><dt>Ledger</dt><dd className={v.reconcile.ok ? "okc" : "bad"}>{v.reconcile.ok ? "✓ Reconciled" : "✕ Not reconciled"}</dd></div>
        </dl>
        <button type="button" className={`btn ${step.mine ? "go" : "secondary"}`} onClick={(e) => { e.stopPropagation(); open(); }}>
          {step.mine ? "Open vault" : "Open"}
        </button>
      </footer>
    </article>
  );
}

export function Dashboard() {
  const app = useApp();
  const { state } = useVaultList();
  const me = accountAddress(app.role);
  const list = useMemo(() => (state.status === "ready" ? state.list : []), [state]);
  const ready = state.status === "ready";
  const totals = useMemo(() => totalsOf(list), [list]);
  const attention = useMemo(() => attentionFor(list, me), [list, me]);
  // How many things wait on each account, so the switcher can say where the next move is.
  const counts = useMemo(() => ACCOUNT_ROLES.map((r) => attentionFor(list, accountAddress(r)).length), [list]);
  const flow = useMemo(
    () => list.reduce((s, v) => ({ deposited: s.deposited + v.reconcile.deposited, released: s.released + v.reconcile.released, refunded: s.refunded + v.reconcile.refunded, withdrawn: s.withdrawn + v.reconcile.withdrawn }), { deposited: 0n, released: 0n, refunded: 0n, withdrawn: 0n }),
    [list],
  );
  const elsewhere = counts.findIndex((n, i) => n > 0 && i !== app.roleIdx);
  const myRole = ROLE_LABEL[app.role as Role] ?? "";

  return (
    <div className="dash">
      <div className="pagehead">
        <div>
          <h1>Dashboard</h1>
          <p className="muted lede">
            Acting as <b>{app.names[app.role]}</b>{myRole ? ` (${myRole.toLowerCase()})` : ""}. Everything here is read live from the chain; nothing is stored on a server.
          </p>
        </div>
        <div className="pagehead-actions">
          <button className="btn secondary" type="button" onClick={() => navigate(`/vault/${deployment.preseededVault.address}`)}>Open the demo vault</button>
          <button className="btn go" type="button" onClick={() => navigate("/agreement")}>Draft an agreement</button>
        </div>
      </div>

      <div className="dstats" data-testid="dash-stats">
        <Stat
          icon={<Icon><path d="M4 7l8-4 8 4v10l-8 4-8-4z" /><path d="M4 7l8 4 8-4M12 11v10" /></Icon>}
          label="Vaults"
          value={ready ? <span data-testid="stat-vaults">{totals.vaults}</span> : "—"}
          hint={ready ? `${totals.active} active` : "reading the chain"}
        />
        <Stat
          icon={<Icon><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Icon>}
          label="In escrow"
          value={ready ? <Amount wei={totals.inEscrow} /> : "—"}
          hint="locked until a rule releases it"
        />
        <Stat
          icon={<Icon><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>}
          label="Owed, not withdrawn"
          value={ready ? <Amount wei={totals.owed} /> : "—"}
          hint="released, waiting to be taken"
        />
        <Stat
          icon={<Icon><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5L16 9.5" /></Icon>}
          label="Ledgers"
          tone={ready ? (totals.allReconciled ? "ok" : "bad") : undefined}
          value={<span data-testid="stat-ledgers">{!ready ? "—" : totals.allReconciled ? "✓ All reconciled" : "✕ Check a vault"}</span>}
          hint="deposits minus payouts equals the balance"
        />
      </div>

      <div className="dgrid">
        <div className="dmain">
          <section className="panel dcard" aria-label="Waiting on you">
            <div className="dcard-head">
              <h2>Waiting on you{ready && attention.length > 0 && <span className="count" aria-label={`${attention.length} waiting`}>{attention.length}</span>}</h2>
            </div>
            <div className="actas" role="group" aria-label="Acting as">
              {ACCOUNT_ROLES.map((r, i) => (
                <button key={r} type="button" aria-pressed={i === app.roleIdx} onClick={() => app.setRoleIdx(i)} title={`Act as ${app.names[r]}`}>
                  <span className="n">{app.names[r]}</span>
                  <span className="r">{ROLE_LABEL[r as Role] ?? r}</span>
                  {ready && counts[i] > 0 && <span className="dot-count" aria-label={`${counts[i]} waiting`}>{counts[i]}</span>}
                </button>
              ))}
            </div>

            {state.status === "loading" && <VaultTableSkeleton />}
            {state.status === "error" && <p className="empty" role="alert">Couldn't read the chain: {state.message}. Is it running? <code>npm run chain</code></p>}
            {ready && attention.length === 0 && (
              <div className="allclear">
                <span className="allclear-ic" aria-hidden="true"><Icon><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon></span>
                <div>
                  <p><b>You're all caught up.</b></p>
                  <p className="muted small">
                    {list.length === 0
                      ? "There are no vaults yet. Draft an agreement to create one."
                      : elsewhere >= 0
                        ? `Nothing is waiting on ${app.names[app.role]}, but ${app.names[ACCOUNT_ROLES[elsewhere]]} has ${counts[elsewhere]} thing${counts[elsewhere] === 1 ? "" : "s"} to do.`
                        : `Nothing is waiting on ${app.names[app.role]} right now.`}
                  </p>
                  {elsewhere >= 0 && list.length > 0 && (
                    <button className="btn secondary" type="button" style={{ marginTop: 10 }} onClick={() => app.setRoleIdx(elsewhere)}>
                      Switch to {app.names[ACCOUNT_ROLES[elsewhere]]}
                    </button>
                  )}
                </div>
              </div>
            )}
            {attention.length > 0 && (
              <ul className="attention" data-testid="attention">
                {attention.map((a) => (
                  <li key={a.vault.address + a.kind}>
                    <span className={`att-ic ${a.kind}`} aria-hidden="true">{a.kind === "move" ? "→" : "↓"}</span>
                    <div className="att-body">
                      <b>{vaultName(a.vault)}</b>
                      <span>{a.headline}</span>
                      {a.milestone && <span className="muted small">Milestone {a.milestone.number} · <Amount wei={a.milestone.amount} /></span>}
                    </div>
                    <button className="btn go" type="button" onClick={() => navigate(`/vault/${a.vault.address}`)}>{a.kind === "move" ? "Open vault" : "Withdraw"}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="dsection" aria-label="Your vaults">
            <div className="dsection-head">
              <h2>Vaults</h2>
              <button className="linklike small" type="button" onClick={() => navigate("/vaults")}>See all vaults</button>
            </div>
            {state.status === "loading" && <div className="panel"><VaultTableSkeleton /></div>}
            {ready && list.length === 0 && (
              <div className="panel empty">
                <p>No agreements yet.</p>
                <p className="muted small">Draft one from text, or open the demo vault.</p>
                <div className="actions" style={{ marginTop: 10 }}>
                  <button className="btn go" type="button" onClick={() => navigate("/agreement")}>Draft an agreement</button>
                  <button className="btn secondary" type="button" onClick={() => navigate(`/vault/${deployment.preseededVault.address}`)}>Open the demo vault</button>
                </div>
              </div>
            )}
            {ready && list.slice(0, 5).map((v) => <VaultCard key={v.address} v={v} me={me} />)}
          </section>
        </div>

        <aside className="daside" aria-label="More">
          <section className="panel dcard dmoney" aria-label="Where the money is">
            <div className="dcard-head"><h2>Where the money is</h2></div>
            <dl>
              <div><dt>Deposited</dt><dd>{ready ? <Amount wei={flow.deposited} /> : "—"}</dd></div>
              <div><dt>Released to providers</dt><dd>{ready ? <Amount wei={flow.released} /> : "—"}</dd></div>
              <div><dt>Refunded to clients</dt><dd>{ready ? <Amount wei={flow.refunded} /> : "—"}</dd></div>
              <div><dt>Withdrawn</dt><dd>{ready ? <Amount wei={flow.withdrawn} /> : "—"}</dd></div>
              <div className="sum"><dt>Still in escrow</dt><dd>{ready ? <Amount wei={totals.inEscrow} /> : "—"}</dd></div>
            </dl>
            <p className="muted small dmoney-note">Simulated funds on a local chain. The contract checks these add up after every move.</p>
          </section>

          <section className="dlab" aria-label="Attack Lab">
            <span className="dlab-art" aria-hidden="true">
              <svg viewBox="0 0 96 96" width="56" height="56"><circle cx="48" cy="48" r="30" fill="none" stroke="currentColor" strokeWidth="3" /><circle cx="48" cy="48" r="9" fill="currentColor" />{Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; const r2 = 38 + (i % 5) * 2; return <line key={i} x1={48 + 33 * Math.cos(a)} y1={48 + 33 * Math.sin(a)} x2={48 + r2 * Math.cos(a)} y2={48 + r2 * Math.sin(a)} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />; })}</svg>
            </span>
            <h2>Try to break it</h2>
            <p className="muted small">Fire 12 real attacks at a sandbox vault, including a re-entrancy attack that drains a naive escrow.</p>
            <button className="btn secondary" type="button" onClick={() => navigate("/attack-lab")}>Open the Attack Lab</button>
          </section>
        </aside>
      </div>
    </div>
  );
}
