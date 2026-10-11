import { useState } from "react";
import { api, ApiOffline, type AdviceMode, type EvidenceResponse } from "../../lib/api";
import { useApp } from "../../lib/app";
import { useNote } from "./Sheets";
import "./evidence.css";

/**
 * Two ADVISORY tools. Neither can approve, refuse, rule, release or refund, and neither output reaches the contract.
 *  - BriefPanel: for the arbiter on a disputed milestone. Per agreed condition: what each side says, with quotes.
 *  - ReviewPanel: for the client before approving. Per agreed condition: does the delivered text seem to address it?
 * A claim is shown as backed only when the server found its quote word for word in the text a person supplied.
 */
const STATUS: Record<string, { icon: string; word: string; cls: "proposed" | "pending" }> = {
  supported: { icon: "◉", word: "Supported by one side", cls: "proposed" },
  contested: { icon: "⚖", word: "Contested", cls: "proposed" },
  "not-addressed": { icon: "○", word: "Not addressed", cls: "pending" },
  "appears-met": { icon: "◉", word: "Appears addressed", cls: "proposed" },
  unclear: { icon: "?", word: "Unclear", cls: "pending" },
  "not-found": { icon: "○", word: "Not found in the text", cls: "pending" },
};
const FROM = { client: "Client", provider: "Provider", deliverable: "Delivered text" } as const;

function useAdvice() {
  const app = useApp();
  const mode: AdviceMode = app.aiMode === "rules" ? "rules" : app.aiMode === "ollama" ? "ollama" : "auto";
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EvidenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (req: Omit<Parameters<typeof api.evidence>[0], "mode">) => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.evidence({ ...req, mode }));
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiOffline ? "The AI service isn't running (start it with npm run server). Nothing was changed." : `Couldn't produce the brief: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return { busy, result, error, run, mode };
}

function Results({ r }: { r: EvidenceResponse }) {
  return (
    <>
      <ul className="ev-list" data-testid="evidence-items">
        {r.items.map((it, i) => {
          const st = STATUS[it.status] ?? STATUS["unclear"];
          return (
            <li key={i}>
              <div className="ev-cond">{it.condition}</div>
              <span className={`chip ${st.cls}`} data-status={it.status}>
                <span aria-hidden="true">{st.icon}</span> {st.word}
              </span>
              {it.downgraded && <span className="muted small"> · no word-for-word quote backed the claim, so it was not counted</span>}
              {it.clientPoints.length > 0 && <p className="small"><b>{r.kind === "review" ? "Shows:" : "Client:"}</b> {it.clientPoints.join(" ")}</p>}
              {it.providerPoints.length > 0 && <p className="small"><b>Provider:</b> {it.providerPoints.join(" ")}</p>}
              {it.quotes.map((q, j) => (
                <blockquote key={j} className="ev-quote"><span className="muted small">{FROM[q.from]} wrote:</span> <q>{q.text}</q></blockquote>
              ))}
            </li>
          );
        })}
      </ul>
      <p className="muted small ev-source">
        {r.meta.source === "rules" ? "Built-in rules (no model used)" : `${r.meta.source === "sarvam" ? "Sarvam" : "Local model"}${r.meta.model ? ` · ${r.meta.model}` : ""}`} · {(r.meta.latencyMs / 1000).toFixed(1)} s
        {r.meta.fallbackReason ? ` · ${r.meta.fallbackReason}` : ""}
      </p>
    </>
  );
}

/** The arbiter's evidence brief (advisory). */
export function BriefPanel({ conditions, evidenceHash }: { conditions: string[]; evidenceHash: string }) {
  const note = useNote(evidenceHash);
  const [provider, setProvider] = useState("");
  const { busy, result, error, run, mode } = useAdvice();
  const clientText = typeof note === "string" ? note : "";
  const canRun = !busy && (clientText.length > 0 || provider.trim().length > 0);
  return (
    <details className="evidence" aria-label="Evidence brief (advisory)" data-testid="brief-panel">
      <summary>Evidence brief <span className="chip proposed">Advisory</span> <span className="muted small">(open to read each side against the conditions; you still rule below)</span></summary>
      <p className="muted small">An AI reads each side's text against the agreed conditions. It does not decide: <b>the arbiter rules</b>, and nothing here is sent to the contract.</p>
      <p className="small"><b>Client's reason:</b> {note === "loading" ? "reading…" : clientText ? <q>{clientText}</q> : <span className="muted">no text stored in this browser (only its seal is on-chain)</span>}</p>
      <label className="small" htmlFor="ev-provider"><b>Provider's evidence</b> (optional, paste it here)</label>
      <textarea id="ev-provider" rows={3} value={provider} maxLength={20000} onChange={(e) => setProvider(e.target.value)} placeholder="What the provider says about each condition…" />
      <div className="actions">
        <button className="btn secondary" type="button" disabled={!canRun} onClick={() => void run({ kind: "brief", conditions, texts: { client: clientText || undefined, provider: provider.trim() || undefined } })} data-testid="brief-run">
          {busy ? "Reading…" : "Generate evidence brief (advisory)"}
        </button>
        <span className="muted small">{mode === "rules" ? "Offline: built-in rules only." : "The text may be sent to the AI service you configured (Sarvam) or the local model."}</span>
      </div>
      {error && <p className="small" role="alert" style={{ color: "var(--revert)" }}>{error}</p>}
      {result && <Results r={result} />}
    </details>
  );
}

/** The client's approval review (advisory), shown inside the approve sheet. */
export function ReviewPanel({ conditions, fileName, fileText }: { conditions: string[]; fileName: string | null; fileText: string | null }) {
  const [typed, setTyped] = useState("");
  const { busy, result, error, run, mode } = useAdvice();
  const text = (typed.trim() || fileText || "").trim();
  return (
    <details className="evidence review" data-testid="review-panel">
      <summary>Check the work against what was agreed (AI, advisory)</summary>
      <p className="muted small">A second pair of eyes for the people-part of approval. The seal comparison above proves it is the same <i>file</i>; this only helps you judge whether the <i>work</i> covers each condition. You decide, and nothing here is sent to the contract.</p>
      {fileText ? <p className="small">Reading the text of <b>{fileName}</b>. You can also paste your own notes below.</p> : <p className="small muted">{fileName ? `${fileName} isn't a text file, so paste the relevant text or your review notes below.` : "Pick a text file above, or paste the delivered text or your notes here."}</p>}
      <textarea rows={3} value={typed} maxLength={40000} onChange={(e) => setTyped(e.target.value)} placeholder="Paste the delivered text, or what you saw…" aria-label="Delivered text to review" />
      <button className="linklike small" type="button" onClick={() => void fetch("/demo/m1-report.txt").then((r) => (r.ok ? r.text() : "")).then((t) => t && setTyped(t)).catch(() => {})} data-testid="review-demo-text">
        Use the demo report's text
      </button>
      <div className="actions">
        <button className="btn secondary" type="button" disabled={busy || text.length === 0} onClick={() => void run({ kind: "review", conditions, texts: { deliverable: text } })} data-testid="review-run">
          {busy ? "Reading…" : "Check against the conditions"}
        </button>
        <span className="muted small">{mode === "rules" ? "Offline: built-in rules only." : "The text may be sent to the AI service you configured (Sarvam) or the local model."}</span>
      </div>
      {error && <p className="small" role="alert" style={{ color: "var(--revert)" }}>{error}</p>}
      {result && <Results r={result} />}
    </details>
  );
}
