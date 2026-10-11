import { useEffect, useRef, useState } from "react";
import { HashSeal } from "./components";
import { formatWei } from "./copy";
import { reconcileFailures, type ReconcileView } from "../lib/vaultModel";

const reduced = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts a wei amount to its new value over ~250 ms (docs/08 motion). Exact at the end, instant under reduced motion. */
function useCountUp(target: bigint, ms = 250): bigint {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced() || from.current === target) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      if (t >= 1) {
        from.current = target;
        setShown(target);
        return;
      }
      setShown(a + ((target - a) * BigInt(Math.round(t * 1000))) / 1000n);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return shown;
}

function Num({ wei, bold }: { wei: bigint; bold?: boolean }) {
  const v = useCountUp(wei);
  return <span style={bold ? { fontWeight: 650 } : undefined}>{formatWei(v)}</span>;
}

export interface LedgerLabels {
  provider: string;
  client: string;
}

/**
 * The ledger as a balance equation. The status word carries a small seal; if a check ever fails the whole panel
 * turns red and names the failing check. The status is announced politely to screen readers.
 */
export function LedgerPanel({ r, block, labels }: { r: ReconcileView; block: number; labels: LedgerLabels }) {
  const failures = reconcileFailures(r);
  const ok = r.ok && failures.length === 0;
  const total = r.deposited;
  const pct = (v: bigint): number => (total === 0n ? 0 : Number((v * 10000n) / total) / 100);
  const owed = r.owedToParties;
  const held = r.heldInEscrow;

  return (
    <section className={`panel ledger${ok ? "" : " bad"}`} aria-label="Ledger">
      <div className="ledger-head">
        <h2>Ledger</h2>
        <span className={`stamp${ok ? "" : " bad"}`} role="status" aria-live="polite">
          {ok ? (
            <>
              <HashSeal hash={"0x" + block.toString(16).padStart(8, "0").repeat(8)} state="onchain" size={22} />
              Reconciled
            </>
          ) : (
            <>✕ Does not reconcile</>
          )}
        </span>
      </div>
      <table className="eq">
        <tbody>
          <tr>
            <td className="op" />
            <td>Deposited</td>
            <td><Num wei={r.deposited} /> ETH</td>
          </tr>
          <tr>
            <td className="op">−</td>
            <td>Released to {labels.provider}</td>
            <td><Num wei={r.released} /></td>
          </tr>
          <tr>
            <td className="op">−</td>
            <td>Refunded to {labels.client}</td>
            <td><Num wei={r.refunded} /></td>
          </tr>
          <tr className="sum">
            <td className="op">=</td>
            <td>Still in escrow</td>
            <td><Num wei={held} bold /></td>
          </tr>
          <tr className="gap">
            <td className="op" />
            <td>Owed, not yet withdrawn</td>
            <td><Num wei={owed} /></td>
          </tr>
          <tr>
            <td className="op" />
            <td>Withdrawn</td>
            <td><Num wei={r.withdrawn} /></td>
          </tr>
          <tr className="sum">
            <td className="op" />
            <td>Contract balance</td>
            <td>
              <Num wei={r.actualBalance} bold /> {ok ? "✓" : "✕"}
            </td>
          </tr>
          <tr>
            <td className="op" />
            <td className="muted">Surplus from forced ETH</td>
            <td className="muted"><Num wei={r.surplus} /></td>
          </tr>
        </tbody>
      </table>
      <div className="stack" role="img" aria-label={`Where the money sits: ${formatWei(held)} in escrow, ${formatWei(owed)} owed, ${formatWei(r.withdrawn)} withdrawn`}>
        <span style={{ width: `${pct(held)}%`, background: "var(--ink-2)" }} />
        <span style={{ width: `${pct(owed)}%`, background: "var(--human)" }} />
        <span style={{ width: `${pct(r.withdrawn)}%`, background: "var(--intaglio)" }} />
      </div>
      <div className="legend">
        <span><i style={{ background: "var(--ink-2)" }} />In escrow</span>
        <span><i style={{ background: "var(--human)" }} />Owed to a party</span>
        <span><i style={{ background: "var(--intaglio)" }} />Paid out</span>
      </div>
      {ok ? (
        <p className="check">Checked after block {block}: escrow equals unsettled milestones, owed equals paid out minus withdrawn, balance equals deposits minus withdrawals.</p>
      ) : (
        <ul className="ledger-fail">
          {failures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
