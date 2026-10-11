import { navigate } from "../lib/router";
import type { VaultSummary } from "../lib/vaultList";
import { AGREEMENT_NAMES } from "../lib/vaultModel";
import { Amount } from "./components";
import { shortHash } from "./copy";

const STATE_CHIP = ["pending", "proposed", "human", "onchain"] as const;
const STATE_ICON = ["✎", "◌", "◉", "✓"] as const;

export const vaultName = (v: VaultSummary): string => v.title ?? `Escrow vault ${shortHash(v.address)}`;

/** The list of vaults. A table on a desktop, a stack of cards on a phone (the cells carry data-label for the cards). */
export function VaultTable({ list, empty }: { list: VaultSummary[]; empty?: React.ReactNode }) {
  if (list.length === 0) return <>{empty ?? null}</>;
  return (
    <table className="vtable" data-testid="vault-table">
      <thead>
        <tr>
          <th>Agreement</th>
          <th>Status</th>
          <th>Progress</th>
          <th className="num">In escrow</th>
          <th className="num">Owed</th>
          <th>Ledger</th>
          <th aria-label="Open" />
        </tr>
      </thead>
      <tbody>
        {list.map((v) => {
          const n = v.milestones.length;
          const pct = n === 0 ? 0 : Math.round((v.settled / n) * 100);
          return (
            <tr key={v.address} data-vault={v.address} onClick={() => navigate(`/vault/${v.address}`)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && navigate(`/vault/${v.address}`)}>
              <td data-label="Agreement" className="vt-name">
                <b>{vaultName(v)}</b>
                <span className="muted small mono">{shortHash(v.address)}</span>
              </td>
              <td data-label="Status">
                <span className={`chip ${STATE_CHIP[v.agreementState] ?? "pending"}`}>
                  <span aria-hidden="true">{STATE_ICON[v.agreementState] ?? "·"}</span>
                  {AGREEMENT_NAMES[v.agreementState] ?? "Unknown"}
                </span>
              </td>
              <td data-label="Progress">
                <div className="vt-progress" role="img" aria-label={`${v.settled} of ${n} milestones settled`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <span className="muted small">{v.settled} of {n} settled</span>
              </td>
              <td data-label="In escrow" className="num"><Amount wei={v.reconcile.heldInEscrow} /></td>
              <td data-label="Owed" className="num"><Amount wei={v.reconcile.owedToParties} /></td>
              <td data-label="Ledger">
                <span className={`vt-ledger ${v.reconcile.ok ? "ok" : "bad"}`}>{v.reconcile.ok ? "✓ Reconciled" : "✕ Not reconciled"}</span>
              </td>
              <td className="vt-open">
                <button type="button" className="btn secondary" onClick={(e) => { e.stopPropagation(); navigate(`/vault/${v.address}`); }}>
                  Open
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Skeleton rows while the chain is being read (the same pattern the reference app uses while loading). */
export function VaultTableSkeleton() {
  return (
    <div className="vt-skeleton" aria-busy="true" aria-label="Reading the chain">
      {[0, 1, 2].map((i) => (
        <div key={i} className="sk-row">
          <span className="sk" style={{ width: "34%" }} />
          <span className="sk" style={{ width: "14%" }} />
          <span className="sk" style={{ width: "18%" }} />
          <span className="sk" style={{ width: "12%" }} />
        </div>
      ))}
    </div>
  );
}
