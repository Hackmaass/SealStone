import { useCallback, useRef, useState } from "react";
import { ALL_ATTACKS, ATTACKS, CONTRAST, runAttack, scoreOf, type AttackDef, type AttackRun } from "../lib/attacks";
import { formatWei } from "../ui/copy";
import { AttackRow } from "../ui/AttackRow";
import { useToast } from "../ui/toast";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The Attack Lab. Every row fires REAL calls from the sandbox accounts at a vault it builds for itself, so a row can
 * run alone, "Run all" can run again and again, and the demo vaults are never touched.
 */
export function AttackLab() {
  const { toast } = useToast();
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
      toast(
        bad === 0 ? (
          <>
            <b>{s.blocked} of {s.total} attacks blocked.</b> The ledger reconciled after each one.
          </>
        ) : (
          <>
            <b>{bad} of {s.total} attacks did not behave as expected.</b> Open the details on the red rows.
          </>
        ),
        bad > 0,
      );
    });

  const runSingle = (def: AttackDef) => guarded(async () => void (await runOne(def)));

  const reset = () => {
    if (lock.current) return;
    setRuns({});
    toast("Cleared. Every run builds a brand-new sandbox vault.");
  };

  const s = scoreOf(runs);
  const ran = s.total - s.notRun;
  const bad = s.failed + s.errored;

  return (
    <div className="lab-page">
      <div className="lab-head">
        <div className="title">
          <h1>Attack Lab</h1>
          <p className="muted">
            Every attack is a real transaction sent from an attacker's account to a fresh sandbox vault that Sealstone builds just for it. Starred rows are the attacks the problem statement requires. The lab uses its own sandbox accounts, so the role switcher in the top bar doesn't apply here, and your demo vaults are never touched.
          </p>
        </div>
        <div className="score" aria-live="polite" data-testid="score">
          <span className="mono" data-testid="score-blocked">{s.blocked}</span> of {s.total} blocked
          {bad > 0 && <span className="muted small"> · {bad} not as expected</span>}
          <div className="muted small" style={{ fontWeight: 400 }} data-testid="score-ledger">
            {ran === 0 ? "Nothing run yet" : `ledger reconciled after ${s.ledgersOk} of ${ran}`}
          </div>
        </div>
        <button className="btn secondary" type="button" disabled={busy} onClick={reset}>Reset sandbox</button>
        <button className="btn" type="button" data-testid="run-all" disabled={busy} onClick={() => void runAll()}>
          {busy ? "Running…" : "Run all attacks"}
        </button>
      </div>

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
              <AttackRow key={def.id} def={def} run={runs[def.id]} cursor={cursor === def.id} busy={busy} onRun={() => void runSingle(def)} />
            ))}
            <AttackRow key={CONTRAST.id} def={CONTRAST} run={runs[CONTRAST.id]} cursor={cursor === CONTRAST.id} busy={busy} onRun={() => void runSingle(CONTRAST)} />
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
