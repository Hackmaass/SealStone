import { useState } from "react";
import { navigate } from "./../lib/router";
import { verdictOf, type AttackDef, type AttackRun, type Step } from "../lib/attacks";
import { formatWei, shortHash } from "./copy";

const KIND_WORD: Record<Step["kind"], string> = { setup: "Setup", attempt: "Attack", check: "Check" };

function StepLine({ s }: { s: Step }) {
  return (
    <li className={`lab-step ${s.ok ? "ok" : "bad"} ${s.kind}`} data-step={s.kind} data-ok={s.ok}>
      <span className="ic" aria-hidden="true">{s.ok ? "✓" : "✕"}</span>
      <div>
        <div>
          <span className="muted small">{KIND_WORD[s.kind]}{s.actor ? ` · ${s.actor}` : ""}</span> {s.label}
        </div>
        {s.kind === "attempt" && (
          <div className="small">
            Expected: <b>{s.expected}</b> · Actual: <b>{s.actual}</b>
          </div>
        )}
        {s.revert && (
          <div className="small">
            <b>{s.revert.title}.</b> {s.revert.detail} Nothing changed.
            <div className="mono raw">{s.revert.raw}</div>
          </div>
        )}
        {s.kind === "check" && s.detail && <div className="small muted">{s.detail}</div>}
        {s.kind === "setup" && !s.ok && s.actual && <div className="small">{s.actual}</div>}
        {s.mined === true && s.txHash && (
          <div className="small muted">
            tx <span className="mono" title={s.txHash}>{shortHash(s.txHash)}</span>
            {s.gasUsed !== undefined && <> · {s.gasUsed.toLocaleString()} gas</>}
          </div>
        )}
        {s.kind === "attempt" && s.mined === false && <div className="small muted">Refused before it was mined: no transaction, no gas, no state change.</div>}
      </div>
    </li>
  );
}

/** One row of the Attack Lab: the plain answer first, the raw error under it, and everything real in the expandable detail. */
export function AttackRow({
  def, run, cursor, busy, onRun,
}: { def: AttackDef; run: AttackRun | undefined; cursor: boolean; busy: boolean; onRun: () => void }) {
  const [open, setOpen] = useState(false);
  const v = verdictOf(def, run);
  const running = cursor && busy;
  const attempts = run?.steps.filter((s) => s.kind !== "setup") ?? [];
  return (
    <>
      <tr className={`${def.contrast ? "contrast " : ""}${cursor ? "cur" : ""}`} data-attack={def.id} data-status={run?.status ?? "idle"}>
        <td>
          {def.booklet && (
            <span className="star" title="Required by the problem statement (R13)" aria-label="Required by the problem statement">
              ★
            </span>
          )}
        </td>
        <td>
          <b>{def.contrast ? <>Contrast: {def.title.replace(/^The same/, "the same")}</> : def.title}</b>
          <div className="muted small">{def.tries}</div>
          <div className="small tags">
            <span className="muted">{def.requirement}</span>
            {def.booklet && <span className="chip proposed">Booklet test</span>}
          </div>
        </td>
        <td className="hide-s">{def.attacker}</td>
        <td data-testid="answer">
          {run ? (
            <>
              <span className="ans">{run.answer.title}</span>
              {run.answer.raw && <span className="err">{run.answer.raw}</span>}
              {run.error && <span className="err bad">{run.error}</span>}
            </>
          ) : (
            <span className="muted">{running ? "Running real transactions…" : "—"}</span>
          )}
        </td>
        <td className="hide-s led" data-testid="ledger" style={run?.ledger.ok === false ? { color: "var(--revert)" } : run?.ledger.ok ? { color: "var(--intaglio)" } : undefined}>
          {run?.ledger.text ?? "—"}
        </td>
        <td>
          <span className={`verdict ${running ? "wait" : v.tone === "blocked" ? "blocked stampin" : v.tone === "unsafe" ? "unsafe stampin" : v.tone === "wait" ? "wait" : "unsafe stampin"}`} data-testid="verdict">
            {running ? "Running…" : v.word}
          </span>
          {run && !running && <div className="muted small">{(run.ms / 1000).toFixed(1)} s</div>}
        </td>
        <td className="lab-actions">
          <button type="button" className="btn secondary" disabled={busy} onClick={onRun} aria-label={`Run: ${def.title}`}>
            Run
          </button>
          <button type="button" className="linklike small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide details" : "Details"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className={`lab-detail${def.contrast ? " contrast" : ""}`}>
          <td />
          <td colSpan={6}>
            {run ? (
              <>
                <ol className="lab-steps">
                  {run.steps.map((s, i) => (
                    <StepLine key={i} s={s} />
                  ))}
                </ol>
                {attempts.length === 0 && <p className="muted small">No attack step ran.</p>}
                {run.drained !== undefined && def.contrast && <p className="small"><b>Stolen:</b> {formatWei(run.drained)} ETH</p>}
                {run.vault && !def.contrast && (
                  <p className="small">
                    Sandbox vault <span className="mono">{shortHash(run.vault)}</span>{" "}
                    <button type="button" className="linklike" onClick={() => navigate(`/vault/${run.vault}`)}>Open it in the vault view</button>
                  </p>
                )}
              </>
            ) : (
              <p className="muted small">Run this attack to see every call it makes, the contract's exact answer and the transaction details.</p>
            )}
            <details className="proofs" open>
              <summary>Proven in tests</summary>
              <ul data-testid="proofs">
                {def.tests.map((t) => (
                  <li key={t} className="mono small">{t}</li>
                ))}
              </ul>
              <p className="muted small">Run <code>npm run test:contracts</code> to see them pass.</p>
            </details>
          </td>
        </tr>
      )}
    </>
  );
}
