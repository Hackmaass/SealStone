import { useCallback, useMemo, useRef, useState } from "react";
import { useApp } from "../lib/app";
import { NET } from "../lib/network";
import { navigate } from "../lib/router";
import { ALL_ATTACKS, ATTACKS, CONTRAST, duelOf, runAttack, scoreOf, type AttackDef, type AttackRun, type Duel } from "../lib/attacks";
import { formatWei } from "../ui/copy";
import { AttackRow } from "../ui/AttackRow";
import { ContrastCard } from "../ui/ContrastCard";
import { useToast } from "../ui/toast";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The Attack Lab. Every row fires REAL calls from the sandbox accounts at a vault it builds for itself, so a row can
 * run alone, "Run all" can run again and again, and the demo vaults are never touched.
 */
/**
 * The Attack Lab fires real transactions from unlocked sandbox accounts at throw-away vaults, so it only exists on the local test
 * chain. In wallet mode (a public testnet) it explains that instead of pretending: nothing is ever attacked on a public network.
 */
export function AttackLab() {
  if (NET === "wallet") {
    return (
      <div className="panel lab-wallet" data-testid="lab-wallet-notice" data-tour="lab-head">
        <h1>Attack Lab</h1>
        <p>
          The Attack Lab runs on the <b>local test chain</b>. Every attack is a real transaction sent from an attacker's account to a fresh sandbox vault, and that needs accounts the lab controls. It never runs on a public network, and it can't use your wallet.
        </p>
        <p className="muted">
          To try it, run Sealstone on your machine with <code>npm run dev</code> and open the Attack Lab there: it fires 12 real attacks at the contract (including the four the problem statement requires) and checks the books after each one. The test names behind each attack are in the repository's README.
        </p>
        <div className="actions">
          <button className="btn go" type="button" onClick={() => navigate("/dashboard")}>Back to the dashboard</button>
        </div>
      </div>
    );
  }
  return <LocalAttackLab />;
}

function LocalAttackLab() {
  const { toast } = useToast();
  const offline = !useApp().chainOnline; // no chain to attack (for example a hosted preview): the buttons say so instead of failing 13 times
  const offlineWhy = "Needs the local chain: run npm run dev on your machine";
  const [runs, setRuns] = useState<Record<string, AttackRun>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const runOne = useCallback(async (def: AttackDef): Promise<AttackRun> => {
    setCursor(def.id);
    const r = await runAttack(def);
    setRuns((cur) => ({ ...cur, [def.id]: r }));
    return r;
  }, []);

  const guarded = useCallback(
    async (fn: () => Promise<void>) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      try {
        await fn();
      } finally {
        setCursor(null);
        setBusy(false);
        lock.current = false;
      }
    },
    [],
  );

  const runAll = () =>
    guarded(async () => {
      setRuns({}); // a clean slate every time, so the run can be repeated during judging
      const results: AttackRun[] = [];
      for (const def of ALL_ATTACKS) {
        results.push(await runOne(def));
        await sleep(350); // slow enough for the audience to follow the cursor
      }
      const all = Object.fromEntries(results.map((r) => [r.id, r]));
      const s = scoreOf(all);
      const bad = s.failed + s.errored;
      // A success needs no toast: the score above and the comparison card already say it, and a toast would cover the card's last line.
      if (bad > 0) {
        toast(
          <>
            <b>{bad} of {s.total} attacks did not behave as expected.</b> Open the details on the red rows.
          </>,
          true,
        );
      }
    });

  const runSingle = (def: AttackDef) => guarded(async () => void (await runOne(def)));
  // The comparison card needs exactly two runs: the real re-entrancy attack and the same attack on a naive escrow.
  const runDuel = () =>
    guarded(async () => {
      const real = ATTACKS.find((d) => d.id === "reentrancy");
      // drop the previous pair first, so the card shows the old result as "running again" instead of mixing old and new
      setRuns((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => id !== "reentrancy" && id !== CONTRAST.id)));
      if (real) await runOne(real);
      await sleep(350);
      await runOne(CONTRAST);
    });

  const reset = () => {
    if (lock.current) return;
    setRuns({});
    setLast(null);
    toast("Cleared. Every run builds a brand-new sandbox vault.");
  };

  const s = scoreOf(runs);
  const ran = s.total - s.notRun;
  const bad = s.failed + s.errored;
  // Keep showing the last comparison while a new run is under way, so the page does not jump as the audience follows the cursor.
  const fresh = useMemo(() => duelOf(runs), [runs]);
  const [last, setLast] = useState<Duel | null>(null);
  if (fresh && fresh !== last) setLast(fresh);
  const duel = fresh ?? last;

  return (
    <div className="lab-page">
      <div className="lab-head" data-tour="lab-head">
        <div className="title">
          <h1>Attack Lab</h1>
          <p className="muted">
            Every attack is a real transaction sent from an attacker's account to a fresh sandbox vault that Sealstone builds just for it. Starred rows are the attacks the problem statement requires. The lab uses its own sandbox accounts, so the "Acting as" switcher doesn't apply here, and your demo vaults are never touched.
          </p>
        </div>
        <div className="score" aria-live="polite" data-testid="score">
          <span className="mono" data-testid="score-blocked">{s.blocked}</span> of {s.total} blocked
          {bad > 0 && <span className="muted small"> · {bad} not as expected</span>}
          <div className="muted small" style={{ fontWeight: 400 }} data-testid="score-ledger">
            {ran === 0 ? "Nothing run yet" : `ledger reconciled after ${s.ledgersOk} of ${ran}`}
          </div>
        </div>
        <button className="btn secondary" type="button" disabled={busy || offline} title={offline ? offlineWhy : undefined} onClick={reset}>Reset sandbox</button>
        <button className="btn" type="button" data-testid="run-all" disabled={busy || offline} title={offline ? offlineWhy : undefined} onClick={() => void runAll()}>
          {busy ? "Running…" : "Run all attacks"}
        </button>
      </div>

      <ContrastCard duel={duel} stale={fresh === null && duel !== null} busy={busy} offline={offline} onRun={() => void runDuel()} />

      <div className="panel" style={{ overflow: "auto" }}>
        <table className="lab">
          <thead>
            <tr>
              <th aria-label="Required by the booklet" />
              <th>Attack</th>
              <th className="hide-s">Attacker</th>
              <th>Contract's answer</th>
              <th className="hide-s">Ledger</th>
              <th>Verdict</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {ATTACKS.map((def) => (
              <AttackRow key={def.id} def={def} run={runs[def.id]} cursor={cursor === def.id} busy={busy || offline} onRun={() => void runSingle(def)} />
            ))}
            <AttackRow key={CONTRAST.id} def={CONTRAST} run={runs[CONTRAST.id]} cursor={cursor === CONTRAST.id} busy={busy || offline} onRun={() => void runSingle(CONTRAST)} />
          </tbody>
        </table>
      </div>
      <p className="lab-note">
        <span className="star">★</span> required by the problem statement (R13). Refused attempts are never mined: they cost no gas and change no state, which is why the ledger stays reconciled.
        {s.contrastDrained !== null && (
          <>
            {" "}
            The red row shows why that matters: without the protections, the same attack stole <b>{formatWei(s.contrastDrained)} ETH</b>.
          </>
        )}
      </p>
    </div>
  );
}
