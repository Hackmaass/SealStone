import { useRef, useState } from "react";
import { HashSeal, HashText } from "../../ui/components";
import { checkDroppedFile, checkTerms, type TermsCheck } from "../../lib/terms";

const SOURCE_WORD = { server: "the AI service's copy", browser: "this browser's copy", file: "your file", text: "the text you edited" } as const;

/** The one-line result shown in the header. Always a word and an icon, never colour alone. */
export function TermsBadge({ terms, checking }: { terms: TermsCheck | null; checking: boolean }) {
  if (checking || !terms) return <span className="chip pending" data-testid="terms-badge">Checking the terms…</span>;
  switch (terms.kind) {
    case "verified":
      return <span className="chip onchain" data-testid="terms-badge" data-result="verified">✓ Terms match the signed seal</span>;
    case "mismatch":
      return <span className="chip revert" data-testid="terms-badge" data-result="mismatch">✕ These aren't the signed terms</span>;
    case "invalid":
      return <span className="chip revert" data-testid="terms-badge" data-result="invalid">✕ Not valid confirmed terms</span>;
    default:
      return <span className="chip proposed" data-testid="terms-badge" data-result="unavailable">Terms not found to check</span>;
  }
}

/**
 * "Verify agreement": recompute the canonical JSON and keccak256 in THIS browser and compare them with the hash the
 * contract stores. The JSON is editable so anyone can change one character and watch the seal change.
 */
export function TermsPanel({ onChainHash, terms: stored, onRecheck }: { onChainHash: string; terms: TermsCheck | null; onRecheck: () => void }) {
  // A probe is the visitor's own experiment (an edited text or a dropped file). It is shown HERE only: the page header
  // keeps showing the verdict on the real stored terms, so playing with the text never changes who the page names.
  const [probe, setProbe] = useState<TermsCheck | null>(null);
  const terms = probe ?? stored;
  const onResult = setProbe;
  const canonical = stored && stored.kind !== "unavailable" && stored.kind !== "invalid" ? stored.canonical : "";
  const [text, setText] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const shown = text ?? canonical;

  const checkText = () => {
    try {
      onResult(checkTerms(JSON.parse(shown), onChainHash, "text"));
    } catch {
      onResult({ kind: "invalid", source: "text", errors: ["That text isn't valid JSON."] });
    }
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = await checkDroppedFile(f, onChainHash);
    setText(null);
    onResult(r);
  };

  const computed = terms?.kind === "verified" ? onChainHash : terms?.kind === "mismatch" ? terms.computed : null;
  return (
    <details className="terms-panel" data-testid="terms-panel">
      <summary>Verify the agreement</summary>
      <p className="muted small">
        The contract only stores a seal (a hash) of the confirmed terms. Your browser recomputes that seal from the terms and compares the two. Change any character below and check again.
      </p>
      <div
        className={`drop${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void onFile(e.dataTransfer.files[0]);
        }}
      >
        <input ref={input} type="file" accept=".json,application/json" hidden aria-label="Choose a confirmed terms file" onChange={(e) => void onFile(e.target.files?.[0])} />
        <button type="button" className="btn secondary" onClick={() => input.current?.click()}>Check a JSON file…</button>
        <button type="button" className="btn secondary" onClick={() => { setText(null); setProbe(null); onRecheck(); }}>Re-check the stored terms</button>
        <span className="muted small">or edit the terms here:</span>
      </div>
      <textarea
        className="terms-json mono"
        aria-label="Confirmed terms JSON"
        spellCheck={false}
        value={shown}
        placeholder="The confirmed terms will appear here when they are found. You can also drop a file above."
        onChange={(e) => setText(e.target.value)}
      />
      <div className="foot" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="btn" disabled={shown.trim() === ""} onClick={checkText}>Check this text</button>
      </div>
      {terms && terms.kind !== "unavailable" && <ProbeResult terms={terms} />}
      {terms && terms.kind !== "unavailable" && (
        <div className={`compare${terms.kind === "verified" ? "" : " bad"}`} aria-live="polite">
          <div className="side">
            <HashSeal hash={onChainHash} state="onchain" size={64} />
            <span>On the chain</span>
            <HashText hash={onChainHash} />
          </div>
          <div className={`verdict ${terms.kind === "verified" ? "ok" : "bad"}`}>
            {terms.kind === "verified" ? "Seals match" : terms.kind === "mismatch" ? "Different terms" : "Not valid terms"}
          </div>
          <div className="side">
            {computed ? <HashSeal hash={computed} state={terms.kind === "verified" ? "onchain" : "mismatch"} size={64} /> : <div className="seal-empty" aria-hidden="true" />}
            <span>Recomputed from {SOURCE_WORD[terms.source]}</span>
            {computed ? <HashText hash={computed} /> : <span className="muted small">{terms.kind === "invalid" ? terms.errors.join(" ") : ""}</span>}
          </div>
        </div>
      )}
      {terms?.kind === "unavailable" && (
        <p className="muted small">
          The confirmed terms for this seal aren't on the AI service or in this browser (they may have been confirmed on another computer). Drop the confirmed JSON file above to check it.
        </p>
      )}
    </details>
  );
}

/** The verdict for whatever was just checked inside this panel (the stored terms, an edit, or a dropped file). */
function ProbeResult({ terms }: { terms: Exclude<TermsCheck, { kind: "unavailable" }> }) {
  const label = terms.kind === "verified" ? "✓ These are the signed terms" : terms.kind === "mismatch" ? "✕ These aren't the signed terms" : "✕ Not valid confirmed terms";
  return (
    <p className={`chip ${terms.kind === "verified" ? "onchain" : "revert"}`} style={{ marginTop: 12 }} data-testid="probe-result" data-result={terms.kind} role="status">
      {label}
    </p>
  );
}
