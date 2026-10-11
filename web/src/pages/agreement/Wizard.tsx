import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { checkGate, validate, type GateInput } from "@mv/shared";
import { api, ApiOffline, ApiRejected, type ExtractResponse, type Mode } from "../../lib/api";
import { useApp } from "../../lib/app";
import { accountAddress } from "../../lib/chain";
import { extractLocally } from "../../lib/localExtract";
import { STEP_NAMES, gateReasons, loadState, reducer, saveState, summarizeGate, type Step, type WizardState } from "../../lib/wizard";
import { useToast } from "../../ui/toast";
import { DocView } from "./DocView";
import { StepChain } from "./StepChain";
import { StepConfirm } from "./StepConfirm";
import { StepResolve } from "./StepResolve";

const SOURCE_LABEL = { ollama: "Ollama", gemini: "Gemini", rules: "Rules" } as const;

function gateInputOf(state: WizardState): Omit<GateInput, "confirmedAt"> | null {
  if (!state.extraction || !state.edited) return null;
  return {
    proposed: state.extraction.proposed,
    edited: state.edited,
    sourceText: state.text,
    resolutions: Object.values(state.resolutions),
    addresses: state.addresses,
    reviewWindowSeconds: state.reviewWindowSeconds,
    extraction: { source: state.extraction.meta.source, model: state.extraction.meta.model },
  };
}

export function Wizard() {
  const app = useApp();
  const { toast } = useToast();
  const defaults = { client: accountAddress("client"), provider: accountAddress("provider"), arbiter: accountAddress("arbiter") };
  const [state, dispatch] = useReducer(reducer, defaults, loadState);
  useEffect(() => saveState(state), [state]);

  // ── the gate, computed locally with the SAME shared code the server uses ──
  const input = useMemo(() => gateInputOf(state), [state]);
  const gate = useMemo(() => (input ? checkGate({ ...input, confirmedAt: "1970-01-01T00:00:00.000Z" }) : null), [input]);
  const summary = useMemo(() => (gate ? summarizeGate(gate, new Set(Object.keys(state.resolutions))) : null), [gate, state.resolutions]);
  const editedIds = useMemo(
    () => (state.edited ? new Set(validate(state.edited, state.text, "edited").ambiguities.map((a) => a.id)) : new Set<string>()),
    [state.edited, state.text],
  );

  const locked = state.deployed !== null;
  const goto = (step: Step) => dispatch({ type: "goto", step });

  // ── step 1: extraction ──
  const [samples, setSamples] = useState<Array<{ name: string; text: string }>>([]);
  const [busy, setBusy] = useState<{ mode: Mode; started: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const choseRules = useRef(false);

  useEffect(() => {
    api.samples().then(setSamples).catch(() => setSamples([]));
  }, []);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - busy.started) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy]);

  async function runExtract() {
    const text = state.text;
    const mode = app.aiMode;
    choseRules.current = false;
    let res: ExtractResponse;
    if (mode === "rules") {
      res = extractLocally(text);
    } else {
      const controller = new AbortController();
      abort.current = controller;
      setBusy({ mode, started: Date.now() });
      setElapsed(0);
      try {
        res = await api.extract(text, mode, controller.signal);
      } catch (e) {
        if (e instanceof ApiRejected) {
          toast(<b>{e.message}</b>, true);
          setBusy(null);
          return;
        }
        const reason = choseRules.current
          ? "You chose the built-in rules instead."
          : e instanceof ApiOffline
            ? "The AI service isn't running. Checked with the built-in rules instead."
            : "The AI took too long. Checked with the built-in rules instead.";
        res = extractLocally(text, reason, mode);
      } finally {
        abort.current = null;
        setBusy(null);
      }
    }
    dispatch({ type: "extracted", text, extraction: { proposed: res.proposed, meta: res.meta, notes: res.notes, hardErrors: res.hardErrors } });
    app.setLastAi({ source: res.meta.source, model: res.meta.model, latencyMs: res.meta.latencyMs });
    app.refreshHealth();
  }

  const stepper = (
    <ol className="steps" id="steps">
      {STEP_NAMES.map((name, k) => {
        const n = (k + 1) as Step;
        const cls = n < state.step ? "done" : n === state.step ? "now" : "";
        const reachable = n < state.step && !(locked && n < 5);
        return (
          <li key={name} className={cls} aria-current={n === state.step ? "step" : undefined} style={reachable ? { cursor: "pointer" } : undefined} onClick={() => reachable && goto(n)}>
            {name}
          </li>
        );
      })}
    </ol>
  );

  const startOver = (
    <button className="btn secondary" type="button" onClick={() => dispatch({ type: "reset", addresses: defaults })}>
      Start over
    </button>
  );

  // ── render ──
  if (state.step === 1) {
    return (
      <>
        {stepper}
        <div className="panel doc">
          <div className="doc-head">
            <div>
              <h1>Paste the agreement</h1>
              <p className="muted small">The AI proposes a checklist and flags what is unclear. It never touches the chain.</p>
            </div>
            <label className="field" style={{ minWidth: 220 }}>
              Load a sample
              <select
                aria-label="Load a sample"
                value=""
                onChange={(e) => {
                  const s = samples.find((x) => x.name === e.target.value);
                  if (s) dispatch({ type: "text", text: s.text });
                }}
              >
                <option value="">{samples.length ? "Choose a sample…" : "No samples (server offline)"}</option>
                {samples.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name.replace(/\.txt$/, "")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <textarea className="agreement" aria-label="Agreement text" placeholder="Paste the agreement text here…" value={state.text} onChange={(e) => dispatch({ type: "text", text: e.target.value })} disabled={busy !== null} />
          {busy && (
            <div role="status" style={{ marginTop: 14 }}>
              <p>
                Reading the agreement with {busy.mode === "auto" ? "the AI" : SOURCE_LABEL[busy.mode as keyof typeof SOURCE_LABEL] ?? busy.mode}… <span className="mono">{elapsed} s</span>
              </p>
              <div className="skeleton" style={{ width: "80%" }} />
              <div className="skeleton" style={{ width: "62%" }} />
              {elapsed >= 8 && (
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    choseRules.current = true;
                    abort.current?.abort();
                  }}
                >
                  Use rules instead
                </button>
              )}
            </div>
          )}
          <div className="step-actions">
            <button className="btn go" type="button" disabled={state.text.trim().length < 20 || busy !== null} onClick={() => void runExtract()}>
              Extract
            </button>
            <span className="muted small">Mode: {app.aiMode === "rules" ? "built-in rules (works offline)" : app.aiMode}. Change it in the top bar.</span>
            {state.extraction && (
              <button className="btn secondary" type="button" onClick={() => goto(2)}>
                Back to the proposal
              </button>
            )}
          </div>
        </div>
      </>
    );
  }

  if (!state.extraction || !state.edited || !gate || !summary) {
    return (
      <div className="panel vault-note">
        <p>The wizard lost its place. Start again from the pasted text.</p>
        {startOver}
      </div>
    );
  }

  const meta = state.extraction.meta;
  const proposed = state.extraction.proposed;

  if (state.step === 2) {
    const hard = state.extraction.hardErrors;
    return (
      <>
        {stepper}
        <div className="studio">
          <div className="panel doc">
            <div className="doc-head">
              <div>
                <h1>{proposed.title}</h1>
                <p className="muted small">Amber marks are what the AI or the rule checks flagged.</p>
              </div>
            </div>
            <DocView text={state.text} flags={gate.required} milestoneQuotes={proposed.milestones.map((m) => m.quote)} resolutions={state.resolutions} />
          </div>
          <aside className="panel rail cl-pane" aria-label="Proposed checklist">
            <div className="rail-head">
              <h2>Proposed checklist</h2>
              <span className="chip proposed">
                Proposed by {SOURCE_LABEL[meta.source]}
                {meta.model ? ` · ${meta.model}` : ""} · {(meta.latencyMs / 1000).toFixed(1)} s
              </span>
            </div>
            {meta.fallbackReason && (
              <p className="status-note open" role="status">
                {meta.requestedMode !== "rules" && meta.source === "rules" && !meta.fallbackReason.includes("built-in rules") ? "The AI was not used. Checked with the built-in rules instead. " : ""}
                {meta.fallbackReason}
              </p>
            )}
            {state.extraction.notes.map((n) => (
              <p key={n} className="status-note open">{n}</p>
            ))}
            {hard.map((h) => (
              <p key={h} className="status-note" style={{ color: "var(--revert)" }}>✕ {h}</p>
            ))}
            <p className="small muted">Parties</p>
            <ul className="cond-list" style={{ marginBottom: 12 }}>
              {(["client", "provider", "arbiter"] as const).map((r) => (
                <li key={r}>
                  {r}: <span className="proposed-val">{proposed.parties[r].name ?? "not named"}</span>
                </li>
              ))}
            </ul>
            <table>
              <thead>
                <tr><th>#</th><th>Milestone</th><th>Due</th><th style={{ textAlign: "right" }}>Amount</th></tr>
              </thead>
              <tbody>
                {proposed.milestones.map((m) => (
                  <tr key={m.index}>
                    <td className="mono">{m.index + 1}</td>
                    <td>
                      <span className="proposed-val">{m.title}</span>
                      <ul className="cond-list">
                        {m.conditions.map((c, j) => (
                          <li key={j}>{c.text}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="proposed-val">{m.deadline ?? "none"}</td>
                    <td className="mono proposed-val" style={{ textAlign: "right" }}>{m.amount ? `${m.amount} ETH` : "not stated"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 8 }}>Stated total: <span className="proposed-val">{proposed.totalStated ? `${proposed.totalStated} ETH` : "none"}</span> · {gate.required.length} {gate.required.length === 1 ? "issue" : "issues"} flagged</p>
          </aside>
        </div>
        <div className="step-actions">
          <button className="btn secondary" type="button" onClick={() => goto(1)}>Change the text</button>
          <button className="btn go" type="button" disabled={hard.length > 0} onClick={() => goto(3)}>
            Resolve the issues
          </button>
          {hard.length > 0 && <span className="muted small">Fix the text and extract again.</span>}
        </div>
      </>
    );
  }

  if (state.step === 3) {
    return (
      <>
        {stepper}
        <StepResolve
          state={state}
          dispatch={dispatch}
          required={gate.required}
          editedIds={editedIds}
          summary={summary}
          resolvedBy={app.role === "provider" ? "provider" : "client"}
          onNext={() => goto(4)}
        />
      </>
    );
  }

  if (state.step === 4) {
    return (
      <>
        {stepper}
        <StepConfirm state={state} dispatch={dispatch} summary={summary} reasons={gateReasons(summary, true)} input={input!} onBack={() => goto(3)} onNext={() => goto(5)} />
      </>
    );
  }

  return (
    <>
      {stepper}
      <StepChain state={state} dispatch={dispatch} startOver={startOver} />
    </>
  );
}
