import { useMemo } from "react";
import { useApp } from "../lib/app";
import { ACCOUNT_ROLES, accountAddress, deployment } from "../lib/chain";
import { navigate } from "../lib/router";
import { totalsOf, type VaultSummary } from "../lib/vaultList";
import { useVaultList } from "../lib/useVaultList";
import { nextStep, roleOfAddress, withdrawPlan } from "../lib/vaultModel";
import { Amount } from "../ui/components";
import { VaultTable, VaultTableSkeleton, vaultName } from "../ui/VaultTable";

interface Attention {
  vault: VaultSummary;
  headline: string;
  detail: string;
}

/** What is waiting on the account the visitor is acting as, across every vault (read live from the chain). */
function attentionFor(list: VaultSummary[], me: string): Attention[] {
  const out: Attention[] = [];
  for (const v of list) {
    const role = roleOfAddress({ client: { name: "", address: v.parties.client }, provider: { name: "", address: v.parties.provider }, arbiter: { name: "", address: v.parties.arbiter } }, me);
    if (role === "stranger") continue;
    const step = nextStep({ role, agreementState: v.agreementState, nextMilestone: v.nextMilestone, milestones: v.milestones, credits: v.credits, reviewWindow: 0n, chainNow: 0n });
    const credit = role === "client" ? v.credits.client : role === "provider" ? v.credits.provider : 0n;
    const wp = withdrawPlan(role, credit);
    if (step.mine) out.push({ vault: v, headline: step.headline.replace(/^Your move: /, ""), detail: "Your move" });
    else if (wp.enabled) out.push({ vault: v, headline: `Withdraw what you are owed.`, detail: wp.label });
  }
  return out;
}

export function Dashboard() {
  const app = useApp();
  const { state } = useVaultList();
  const me = accountAddress(app.role);
  const list = state.status === "ready" ? state.list : [];
  const totals = useMemo(() => totalsOf(list), [list]);
  const attention = useMemo(() => attentionFor(list, me), [list, me]);

  return (
    <div className="dash">
      <div className="pagehead">
        <div>
          <h1>Dashboard</h1>
          <p className="muted lede">Everything that is locked, owed and waiting on you, read live from the chain. Nothing here is stored on a server.</p>
        </div>
        <div className="statrow" data-testid="dash-stats">
          <div className="stat"><span className="k">Vaults</span><span className="v" data-testid="stat-vaults">{state.status === "ready" ? totals.vaults : "—"}</span></div>
          <div className="stat"><span className="k">In escrow</span><span className="v">{state.status === "ready" ? <Amount wei={totals.inEscrow} /> : "—"}</span></div>
          <div className="stat"><span className="k">Owed, not withdrawn</span><span className="v">{state.status === "ready" ? <Amount wei={totals.owed} /> : "—"}</span></div>
          <div className="stat"><span className="k">Ledgers</span><span className={`v ${state.status === "ready" && !totals.allReconciled ? "bad" : "okc"}`} data-testid="stat-ledgers">{state.status !== "ready" ? "—" : totals.allReconciled ? "✓ All reconciled" : "✕ Check a vault"}</span></div>
        </div>
      </div>

      <section className="promo" aria-label="Attack Lab">
        <div className="promo-art" aria-hidden="true">
          <svg viewBox="0 0 96 96" width="72" height="72"><circle cx="48" cy="48" r="30" fill="none" stroke="currentColor" strokeWidth="3" /><circle cx="48" cy="48" r="9" fill="currentColor" />{Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; const r2 = 38 + (i % 5) * 2; return <line key={i} x1={48 + 33 * Math.cos(a)} y1={48 + 33 * Math.sin(a)} x2={48 + r2 * Math.cos(a)} y2={48 + r2 * Math.sin(a)} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />; })}</svg>
        </div>
        <div className="promo-text">
          <h2>Try to break it</h2>
          <p className="muted">Fire 12 real attacks at a sandbox vault, including a re-entrancy attack that drains a naive escrow.</p>
        </div>
        <div className="promo-cta">
          <button className="btn secondary" type="button" onClick={() => navigate("/attack-lab")}>Open the Attack Lab</button>
        </div>
      </section>

      <section className="panel dash-card" aria-label="Waiting on you">
        <div className="dash-card-head">
          <h2>Waiting on you</h2>
          <span className="muted small">Acting as <b>{app.names[app.role]}</b></span>
        </div>
        {state.status === "loading" && <VaultTableSkeleton />}
        {state.status === "ready" && attention.length === 0 && (
          <div className="empty">
            <p>Nothing is waiting on {app.names[app.role]} right now.</p>
            <p className="muted small">Switch who you are acting as to see what the others can do next.</p>
            <div className="actions" style={{ marginTop: 10 }}>
              {ACCOUNT_ROLES.map((r, i) => (
                <button key={r} type="button" className={`btn ${i === app.roleIdx ? "go" : "secondary"}`} aria-pressed={i === app.roleIdx} onClick={() => app.setRoleIdx(i)}>
                  {app.names[r]}
                </button>
              ))}
            </div>
          </div>
        )}
        {attention.length > 0 && (
          <ul className="attention" data-testid="attention">
            {attention.map((a) => (
              <li key={a.vault.address + a.headline}>
                <div>
                  <b>{vaultName(a.vault)}</b>
                  <div className="muted small">{a.headline}</div>
                </div>
                <button className="btn" type="button" onClick={() => navigate(`/vault/${a.vault.address}`)}>{a.detail === "Your move" ? "Open vault" : "Open"}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel dash-card" aria-label="Your vaults">
        <div className="dash-card-head">
          <h2>Vaults</h2>
          <button className="linklike small" type="button" onClick={() => navigate("/vaults")}>See all</button>
        </div>
        {state.status === "loading" && <VaultTableSkeleton />}
        {state.status === "error" && <p className="empty" role="alert">Couldn't read the chain: {state.message}. Is it running? <code>npm run chain</code></p>}
        {state.status === "ready" && (
          <VaultTable
            list={list.slice(0, 5)}
            empty={
              <div className="empty">
                <p>No agreements yet.</p>
                <p className="muted small">Draft one from text, or open the demo vault.</p>
                <div className="actions" style={{ marginTop: 10 }}>
                  <button className="btn go" type="button" onClick={() => navigate("/agreement")}>Draft an agreement</button>
                  <button className="btn secondary" type="button" onClick={() => navigate(`/vault/${deployment.preseededVault.address}`)}>Open the demo vault</button>
                </div>
              </div>
            }
          />
        )}
      </section>

      <div className="dash-actions">
        <button className="btn go" type="button" onClick={() => navigate("/agreement")}>Draft a new agreement</button>
        <button className="btn secondary" type="button" onClick={() => navigate(`/vault/${deployment.preseededVault.address}`)}>Open the demo vault</button>
      </div>
    </div>
  );
}
