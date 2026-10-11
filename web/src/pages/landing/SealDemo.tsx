import { useEffect, useRef, useState } from "react";
import { SealMark } from "./art";

/** The same SHA-256 the contract stores for a delivered file. Runs in the browser; nothing is uploaded. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

interface Side {
  text: string;
  file: { name: string; bytes: Uint8Array } | null;
}

const START = "m1-report.pdf (demo)"; // exactly what the demo vault's first milestone was submitted with
const short = (hex: string) => (hex ? `0x${hex.slice(0, 4)}…${hex.slice(-4)}` : "…");

function useSeal(side: Side): { hex: string; size: number } {
  const [hex, setHex] = useState("");
  const size = side.file ? side.file.bytes.length : new TextEncoder().encode(side.text).length;
  useEffect(() => {
    let alive = true;
    const bytes = side.file ? side.file.bytes : new TextEncoder().encode(side.text);
    sha256Hex(bytes).then((h) => alive && setHex(h)).catch(() => alive && setHex(""));
    return () => {
      alive = false;
    };
  }, [side]);
  return { hex, size };
}

function Panel({ title, side, onChange, tone, hex, size, id }: { title: string; side: Side; onChange: (s: Side) => void; tone: "neutral" | "ok" | "bad"; hex: string; size: number; id: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={`lp-seal-panel ${tone}`}>
      <label htmlFor={id} className="lp-seal-title">{title}</label>
      {side.file ? (
        <div className="lp-seal-file">
          <b>{side.file.name}</b>
          <button type="button" className="lp-link" onClick={() => onChange({ text: side.text, file: null })}>Use text instead</button>
        </div>
      ) : (
        <textarea id={id} rows={2} value={side.text} spellCheck={false} onChange={(e) => onChange({ text: e.target.value, file: null })} />
      )}
      <div className="lp-seal-art" aria-hidden="true">
        <SealMark size={104} hex={hex || "0".repeat(64)} />
      </div>
      <div className="lp-seal-hash mono" title={hex ? `0x${hex}` : undefined}>{short(hex)}</div>
      <div className="lp-seal-meta">
        {size.toLocaleString("en-US")} bytes ·{" "}
        <button type="button" className="lp-link" onClick={() => input.current?.click()}>choose a file</button>
        <input
          ref={input}
          type="file"
          hidden
          aria-label={`Choose a file for: ${title}`}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) onChange({ text: side.text, file: { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } });
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

export function SealDemo() {
  const [a, setA] = useState<Side>({ text: START, file: null });
  const [b, setB] = useState<Side>({ text: START, file: null });
  const sa = useSeal(a);
  const sb = useSeal(b);
  const ready = sa.hex !== "" && sb.hex !== "";
  const same = ready && sa.hex === sb.hex;
  const changeOne = () => {
    const base = b.file ? START : b.text || START;
    // change exactly one character: the last letter becomes the next one in the alphabet
    const last = base.slice(-1);
    const next = /[a-y]/.test(last) ? String.fromCharCode(last.charCodeAt(0) + 1) : last === "z" ? "a" : ")" === last ? "]" : last + "x";
    setB({ text: base.slice(0, -1) + next, file: null });
  };
  return (
    <section id="demo" className="lp-demo lp-card" aria-labelledby="demo-h">
      <div className="lp-center">
        <h2 id="demo-h" className="lp-h2">Every file gets a seal. Try it.</h2>
        <p className="lp-sub">Type anything, or choose a file. Change a single letter and the seal changes completely. Sealstone locks in the seal of what was delivered, and approval only works when the two seals match.</p>
      </div>
      <div className="lp-seal-grid">
        <Panel id="seal-a" title="What the provider delivered" side={a} onChange={setA} tone="neutral" hex={sa.hex} size={sa.size} />
        <div className={`lp-seal-verdict ${ready ? (same ? "ok" : "bad") : ""}`} role="status" aria-live="polite" data-testid="seal-verdict">
          <span className="lp-verdict-icon" aria-hidden="true">{ready ? (same ? "✓" : "✕") : "…"}</span>
          <b>{ready ? (same ? "Same file" : "Different files") : "Sealing…"}</b>
          <span>{ready ? (same ? "Approval goes through" : "Approval would be refused") : ""}</span>
        </div>
        <Panel id="seal-b" title="What you're approving" side={b} onChange={setB} tone={ready ? (same ? "ok" : "bad") : "neutral"} hex={sb.hex} size={sb.size} />
      </div>
      <div className="lp-demo-actions">
        <button type="button" className="lp-btn tonal small" onClick={changeOne} data-testid="seal-change">Change one letter</button>
        <button type="button" className="lp-btn tonal small" onClick={() => { setA({ text: START, file: null }); setB({ text: START, file: null }); }}>Start over</button>
      </div>
      <p className="lp-fine-inline">This runs in your browser. Nothing is uploaded. The first seal is the one waiting for approval in the demo vault.</p>
    </section>
  );
}
