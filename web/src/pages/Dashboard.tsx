import { useMemo, useState } from "react";
import { OpenVault } from "../ui/OpenVault";
import { useApp } from "../lib/app";
import { ACCOUNT_ROLES, accountAddress } from "../lib/chain";
import { navigate } from "../lib/router";
import { totalsOf, type VaultSummary } from "../lib/vaultList";
import { useVaultList } from "../lib/useVaultList";
import { AGREEMENT_NAMES, nextStep, roleOfAddress, withdrawPlan } from "../lib/vaultModel";
import { Amount, HashSeal } from "../ui/components";
import { formatWei, shortHash } from "../ui/copy";
import { VaultTableSkeleton, vaultName } from "../ui/VaultTable";
import { UNIT } from "../lib/units";

const sentence = (s: string): string => s.replace(/^Your move: /, "").replace(/^./, (c) => c.toUpperCase());
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SEGMENT: Record<string, string> = { Pending: "pending", Completed: "proposed", Disputed: "revert", Released: "onchain", Refunded: "human" };

type Filter = "all" | "mine" | "active" | "done";

interface Row {
  vault: VaultSummary;
  /** what happens next, in plain words, for the account you are acting as */
  text: string;
  /** something is waiting on you (a move to make, or money to withdraw) */
  mine: boolean;
  /** the verb on the button */
  cta: string;
}

/** What each vault means for one account, read from the chain-derived summary (never stored). Vaults that need you come first. */
function rowsFor(list: VaultSummary[], me: string): Row[] {
  const rows = list.map((v): Row => {
    const parties = { client: { name: "", address: v.parties.client }, provider: { name: "", address: v.parties.provider }, arbiter: { name: "", address: v.parties.arbiter } };
    const role = roleOfAddress(parties, me);
    const step = nextStep({ role, agreementState: v.agreementState, nextMilestone: v.nextMilestone, milestones: v.milestones, credits: v.credits, reviewWindow: 0n, chainNow: 0n });
    const credit = role === "client" ? v.credits.client : role === "provider" ? v.credits.provider : 0n;
    const withdraw = withdrawPlan(role, credit);
    if (step.mine) return { vault: v, text: sentence(step.headline), mine: true, cta: "Open vault" };
    if (role !== "stranger" && withdraw.enabled) return { vault: v, text: "You have money to withdraw.", mine: true, cta: "Withdraw" };
    return { vault: v, text: sentence(step.headline), mine: false, cta: "Open" };
  });
  return [...rows.filter((r) => r.mine), ...rows.filter((r) => !r.mine)];
}

const isDone = (v: VaultSummary) => v.milestones.length > 0 && v.settled === v.milestones.length;

/** One vault, one row: what it is, how far along, the money in it, and what happens next. */
function VaultRow({ r }: { r: Row }) {
  const v = r.vault;
  const open = () => navigate(`/vault/${v.address}`);
  return (
    <li>
      <article className="vrow" data-vault={v.address} tabIndex={0} aria-label={`${vaultName(v)}. ${r.text}`} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()}>
        <HashSeal hash={v.agreementHash} state="onchain" size={36} />
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
          <span className="muted small">{v.settled} of {v.milestones.length} done · {AGREEMENT_NAMES[v.agreementState] ?? "Unknown"}</span>
        </div>
        <div className="vrow-money"><Amount wei={v.reconcile.heldInEscrow} /></div>
        <p className={`vrow-next${r.mine ? " mine" : ""}`}>
          {r.mine && <span className="tag">Your move</span>}
          <span>{r.text}</span>
        </p>
        <button
          type="button"
          className={`btn vrow-open ${r.mine ? "go" : "secondary"}`}
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
        >
          {r.cta}
        </button>
      </article>
    </li>
  );
}

export function Dashboard() {
  const app = useApp();
  const { state, refresh } = useVaultList();
  const me = app.me;
  const list = useMemo(() => (state.status === "ready" ? state.list : []), [state]);
  const ready = state.status === "ready";
  const totals = useMemo(() => totalsOf(list), [list]);
  const rows = useMemo(() => rowsFor(list, me), [list, me]);
  const waiting = rows.filter((r) => r.mine).length;
  // when nothing waits on you but someone else has a move, say so (one tap to switch)
  const counts = useMemo(() => (app.net === "local" ? ACCOUNT_ROLES.map((r) => rowsFor(list, accountAddress(r)).filter((x) => x.mine).length) : []), [list, app.net]);
  const elsewhere = counts.findIndex((n, i) => n > 0 && i !== app.roleIdx);
  const flow = useMemo(
    () => list.reduce((s, v) => ({ deposited: s.deposited + v.reconcile.deposited, withdrawn: s.withdrawn + v.reconcile.withdrawn, balance: s.balance + v.reconcile.actualBalance }), { deposited: 0n, withdrawn: 0n, balance: 0n }),
    [list],
  );

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const shown = rows.filter((r) => {
    const q = query.trim().toLowerCase();
    if (q && !`${vaultName(r.vault)} ${r.vault.address}`.toLowerCase().includes(q)) return false;
    return filter === "all" || (filter === "mine" && r.mine) || (filter === "active" && !isDone(r.vault)) || (filter === "done" && isDone(r.vault));
  });

  const headline = !ready
    ? "Reading the chain…"
    : list.length === 0
      ? app.net === "wallet" ? "No vaults here yet. Draft an agreement, or open one by its address." : "No vaults yet. Draft an agreement to create one."
      : waiting > 0
        ? `${plural(waiting, "vault")} ${waiting === 1 ? "needs" : "need"} your move.`
        : elsewhere >= 0
          ? `Nothing needs you right now. ${app.names[ACCOUNT_ROLES[elsewhere]]} has a move.`
          : "You're all caught up.";
  const verdict = !ready ? "Checking the ledgers…" : list.length === 0 ? "" : totals.allReconciled ? "✓ Every ledger reconciles" : "✕ A ledger does not reconcile";
  const eth = (wei: bigint) => (ready ? <>{formatWei(wei, 3)}<span className="unit"> {UNIT}</span></> : "—");
  const pills: Array<[Filter, string]> = [["all", "All"], ["mine", waiting > 0 ? `Needs your move (${waiting})` : "Needs your move"], ["active", "Active"], ["done", "Done"]];

  return (
    <div className="dash">
      <header className="dhead" data-testid="dash-stats">
        <div className="dhead-main">
          <h1>Dashboard</h1>
          <p className="dhead-sub" data-testid="dash-headline">
            {headline}
            {ready && waiting === 0 && elsewhere >= 0 && list.length > 0 && (
              <button className="linklike" type="button" onClick={() => app.setRoleIdx(elsewhere)}> Switch to {app.names[ACCOUNT_ROLES[elsewhere]]}</button>
            )}
          </p>
          <p className={`dhead-note${ready && list.length > 0 && !totals.allReconciled ? " bad" : ""}`} data-testid="stat-ledgers" title={ready && list.length > 0 ? `Contract balance ${formatWei(flow.balance, 3)} ETH = deposited ${formatWei(flow.deposited, 3)} ETH − withdrawn ${formatWei(flow.withdrawn, 3)} ETH` : undefined}>
            {verdict}
          </p>
        </div>
        <dl className="dhead-nums" data-tour="money">
          <div>
            <dt>In escrow</dt>
            <dd data-testid="hero-escrow">{eth(totals.inEscrow)}</dd>
          </div>
          <div>
            <dt>Ready to withdraw</dt>
            <dd>{eth(totals.owed)}</dd>
          </div>
          <div>
            <dt>Withdrawn</dt>
            <dd>{eth(flow.withdrawn)}</dd>
          </div>
        </dl>
      </header>

      <div className="dtools">
        <div className="pills" role="group" aria-label="Show">
          {pills.map(([k, label]) => (
            <button key={k} type="button" className="fpill" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="dtools-right">
          <input className="dfilter" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter vaults" aria-label="Filter vaults" />
          <button className="btn go" type="button" onClick={() => navigate("/agreement")}>Draft an agreement</button>
        </div>
      </div>

      <section className="dpanel" aria-label="Vaults" data-testid="attention" data-tour="attention">
        <div className="dpanel-head">
          <h2>Vaults</h2>
          <span className="muted small">
            {ready ? (
              <>
                <span data-testid="stat-vaults">{totals.vaults}</span> {totals.vaults === 1 ? "vault" : "vaults"} · simulated funds on a local chain
              </>
            ) : (
              ""
            )}
          </span>
          <button className="linklike small" type="button" onClick={() => navigate("/vaults")}>See all</button>
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
        {ready && list.length === 0 && (
          <div className="empty">
            <p>No agreements yet.</p>
            <p className="muted small">Draft one from text to create your first vault.</p>
            {app.net === "wallet" && (
              <div style={{ marginTop: 12 }}>
                <OpenVault compact />
              </div>
            )}
          </div>
        )}
        {ready && list.length > 0 && shown.length === 0 && (
          <div className="empty">
            <p>No vault matches.</p>
            <p className="muted small">
              Try another filter or clear the search.{" "}
              <button className="linklike" type="button" onClick={() => { setFilter("all"); setQuery(""); }}>Show all</button>
            </p>
          </div>
        )}
        {ready && shown.length > 0 && (
          <>
            <div className="vthead" aria-hidden="true">
              <span className="c-id">Agreement</span>
              <span className="c-prog">Progress</span>
              <span className="c-money">In escrow</span>
              <span className="c-next">Next step</span>
            </div>
            <ul className="vrows">
              {shown.slice(0, 8).map((r) => (
                <VaultRow key={r.vault.address} r={r} />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
