import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionSheet, HashSeal, HashText } from "../../ui/components";
import { formatWei } from "../../ui/copy";
import { DEMO_FILES, hashFile, hashText, loadDemoFile, noteHash, type HashedFile } from "../../lib/files";
import { loadNote } from "../../lib/notes";

/** Choose what to hash: a built-in demo file, any file from the computer (drop or browse), or pasted text such as a git commit SHA. */
export function FilePicker({ value, onChange, allowText = false, showPicked = true }: { value: HashedFile | null; onChange: (f: HashedFile | null) => void; allowText?: boolean; showPicked?: boolean }) {
  const [demo, setDemo] = useState<Array<HashedFile & { id: string; note: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all(DEMO_FILES.map(async (f) => ({ ...(await loadDemoFile(f.path, f.name)), id: f.path, note: f.note })))
      .then((list) => alive && setDemo(list))
      .catch(() => alive && setDemo([]));
    return () => {
      alive = false;
    };
  }, []);

  const pickDemo = (f: HashedFile & { id: string }) => {
    setSelected(f.id);
    setError(null);
    onChange({ name: f.name, size: f.size, hash: f.hash });
  };
  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setError(null);
      setSelected("own");
      onChange(await hashFile(file));
    } catch {
      setError("That file couldn't be read.");
    }
  };

  return (
    <div className="picker">
      {demo.length > 0 && (
        <div className="files" role="radiogroup" aria-label="Demo files">
          {demo.map((f) => (
            <label key={f.id} className="file">
              <input type="radio" name="deliverable" checked={selected === f.id} onChange={() => pickDemo(f)} />
              <HashSeal hash={f.hash} state="submitted" size={30} />
              <span>
                <b>{f.name}</b> <span className="muted small">demo file</span>
                <br />
                <span className="muted small">{f.note}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div
        className={`drop${over ? " over" : ""}${selected === "own" ? " has" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void pickFile(e.dataTransfer.files[0]);
        }}
      >
        <input ref={input} type="file" aria-label="Choose a file" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
        <button type="button" className="btn secondary" onClick={() => input.current?.click()}>
          Choose a file…
        </button>
        <span className="muted small">or drop one here. It stays on this computer; only its seal is used.</span>
      </div>
      {allowText && (
        <details className="paste">
          <summary>Submit text instead, for example a git commit SHA</summary>
          <textarea aria-label="Text to submit" placeholder="e.g. 9fceb02d0ae598e95dc970b74767f19372d61af8" value={text} onChange={(e) => setText(e.target.value)} />
          <button
            type="button"
            className="btn secondary"
            disabled={text.trim().length === 0}
            onClick={() => {
              void hashText("text deliverable", text).then((f) => {
                setSelected("text");
                onChange(f);
              });
            }}
          >
            Use this text
          </button>
        </details>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      {value && showPicked && (
        <div className="picked" aria-live="polite">
          <HashSeal hash={value.hash} state="submitted" size={44} />
          <div>
            <b>{value.name}</b> <span className="muted small">{value.size.toLocaleString()} bytes</span>
            <br />
            <HashText hash={value.hash} />
          </div>
        </div>
      )}
    </div>
  );
}

function Foot({ children }: { children: ReactNode }) {
  return <div className="foot">{children}</div>;
}

// ───────────────────────── provider: submit work ─────────────────────────
export function SubmitSheet({ open, index, title, busy, onClose, onSend }: { open: boolean; index: number; title: string; busy: boolean; onClose: () => void; onSend: (f: HashedFile) => void }) {
  const [file, setFile] = useState<HashedFile | null>(null);
  useEffect(() => {
    if (!open) setFile(null);
  }, [open]);
  return (
    <ActionSheet open={open} onClose={onClose}>
      <h2>Submit milestone {index + 1}</h2>
      <p className="muted">
        {title}. Choose the file you are delivering. Its seal is recorded on the chain, and the client can only approve <b>this exact file</b>.
      </p>
      <FilePicker value={file} onChange={setFile} allowText />
      <Foot>
        <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
        <button className="btn go" type="button" disabled={!file || busy} onClick={() => file && onSend(file)}>
          {busy ? "Waiting for block…" : "Submit work"}
        </button>
      </Foot>
    </ActionSheet>
  );
}

// ───────────────────────── client: approve with the reviewed file ─────────────────────────
export function ApproveSheet({
  open, index, amount, providerName, submittedHash, busy, onClose, onSend,
}: { open: boolean; index: number; amount: bigint; providerName: string; submittedHash: string; busy: boolean; onClose: () => void; onSend: (f: HashedFile) => void }) {
  const [file, setFile] = useState<HashedFile | null>(null);
  useEffect(() => {
    if (!open) setFile(null);
  }, [open]);
  const match = !!file && file.hash.toLowerCase() === submittedHash.toLowerCase();
  const eth = formatWei(amount);
  return (
    <ActionSheet open={open} onClose={onClose}>
      <h2>Approve milestone {index + 1}</h2>
      <p className="muted">Choose the file you reviewed. An approval only applies to the exact file the provider submitted.</p>
      {/* The chosen file's seal is shown in the comparison below, so the picker doesn't repeat it. */}
      <FilePicker value={file} onChange={setFile} showPicked={false} />
      <div className="compare" data-testid="compare">
        <div className="side">
          <HashSeal hash={submittedHash} state="submitted" size={76} />
          <span>Submitted by {providerName}</span>
          <HashText hash={submittedHash} />
        </div>
        <div className={`verdict ${file ? (match ? "ok" : "bad") : ""}`}>{file ? (match ? "Seals match" : "Different files") : "Choose a file"}</div>
        <div className="side">
          {file ? <HashSeal hash={file.hash} state={match ? "onchain" : "mismatch"} size={76} /> : <div className="seal-empty" aria-hidden="true" />}
          <span>Your file</span>
          {file ? <HashText hash={file.hash} /> : <span className="muted small">nothing chosen yet</span>}
        </div>
      </div>
      <div className="preview" aria-live="polite">
        {!file && <>Pick the file you reviewed to see whether it is the one that was submitted.</>}
        {file && match && (
          <>
            This releases <b>{eth} ETH</b> to {providerName}. It can't be undone.
          </>
        )}
        {file && !match && (
          <>
            <b style={{ color: "var(--revert)" }}>This isn't the submitted file.</b> You can still send it. The contract will refuse it, and nothing will change.
          </>
        )}
      </div>
      <Foot>
        <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
        <button className={match ? "btn go" : "btn"} type="button" disabled={!file || busy} onClick={() => file && onSend(file)}>
          {busy ? "Waiting for block…" : match ? `Approve and release ${eth} ETH` : "Send anyway (the contract decides)"}
        </button>
      </Foot>
    </ActionSheet>
  );
}

// ───────────────────────── a written reason (dispute / ruling) ─────────────────────────
export function ReasonSheet({
  open, title, intro, label, placeholder, sendLabel, busy, minLength = 5, context, onClose, onSend,
}: {
  open: boolean;
  title: string;
  intro: ReactNode;
  label: string;
  placeholder: string;
  sendLabel: string;
  busy: boolean;
  minLength?: number;
  context?: ReactNode;
  onClose: () => void;
  onSend: (text: string, hash: string) => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!open) setText("");
  }, [open]);
  const trimmed = text.trim();
  const ready = trimmed.length >= minLength;
  const hash = ready ? noteHash(trimmed) : null;
  return (
    <ActionSheet open={open} onClose={onClose}>
      <h2>{title}</h2>
      <div className="muted">{intro}</div>
      {context}
      <label className="field" style={{ display: "block", marginTop: 12 }}>
        <span className="small"><b>{label}</b></span>
        <textarea aria-label={label} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="picked" style={{ minHeight: 48 }} aria-live="polite">
        {hash ? (
          <>
            <HashSeal hash={hash} state="submitted" size={44} />
            <div>
              <span className="muted small">Your text is sealed before it is sent. Only the seal goes on the chain.</span>
              <br />
              <HashText hash={hash} />
            </div>
          </>
        ) : (
          <span className="muted small">Write at least {minLength} characters.</span>
        )}
      </div>
      <Foot>
        <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
        <button className="btn go" type="button" disabled={!ready || busy} onClick={() => hash && onSend(trimmed, hash)}>
          {busy ? "Waiting for block…" : sendLabel}
        </button>
      </Foot>
    </ActionSheet>
  );
}

/** Fetches a stored note (the readable text behind an evidence/rationale hash) from the AI service, if it has it. */
export function useNote(hash: string | null): string | null | "loading" {
  const [state, setState] = useState<string | null | "loading">("loading");
  useEffect(() => {
    if (!hash || /^0x0+$/.test(hash)) {
      setState(null);
      return;
    }
    let alive = true;
    setState("loading");
    void loadNote(hash).then((t) => alive && setState(t));
    return () => {
      alive = false;
    };
  }, [hash]);
  return state;
}
