import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { HELP_TEXT, ruleReply, type AssistantAction, type AssistantContext } from "@mv/shared";
import { api, ApiOffline, type AdviceMeta, type AdviceMode } from "../lib/api";
import { useApp } from "../lib/app";
import { ACCOUNT_ROLES, accountAddress } from "../lib/chain";
import { navigate } from "../lib/router";
import { useVaultList } from "../lib/useVaultList";
import { nextStep, roleOfAddress } from "../lib/vaultModel";
import { vaultName } from "./VaultTable";
import "./assistant.css";

/**
 * The Sealstone assistant. PROPOSAL-ONLY: it answers and SUGGESTS (each suggestion is a button a person clicks), and every
 * suggestion is one of a short, validated list (docs: shared/src/assistant.ts). It has no way to sign, fund, approve, dispute,
 * resolve or withdraw: those only happen in the vault's own confirmation sheets. Sarvam (if the server has a key) or the local
 * model writes the words; the built-in rules answer when neither is reachable, so it works with Wi-Fi off.
 */
interface Msg {
  role: "user" | "assistant";
  text: string;
  actions?: AssistantAction[];
  meta?: AdviceMeta;
}

const STARTERS = ["What's next for me?", "Show me the Attack Lab", "Explain the three seals", "Are the ledgers balanced?"];

const SOURCE_WORD = { sarvam: "Sarvam", ollama: "Local model", rules: "Built-in rules" } as const;

function Launcher({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="asst-fab" type="button" onClick={onOpen} aria-label="Open the Sealstone assistant" title="Ask the assistant (it only suggests)">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" /><path d="M9 11h6M9 14h4" /></svg>
      <span>Ask</span>
    </button>
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const { state } = useVaultList();
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: `Hi, I'm the Sealstone assistant. ${HELP_TEXT}` }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);
  const latest = useRef<{ context: AssistantContext; loading: boolean }>({ context: { path: "", role: "stranger", roleName: "", chainOnline: true, vaults: [] }, loading: true });
  const inputRef = useRef<HTMLInputElement>(null);

  const context = useMemo<AssistantContext>(() => {
    const me = accountAddress(app.role);
    const list = state.status === "ready" ? state.list : [];
    return {
      path: location.pathname,
      role: app.role,
      roleName: app.names[app.role],
      chainOnline: app.chainOnline,
      vaults: list.slice(0, 8).map((v) => {
        const role = roleOfAddress({ client: { name: "", address: v.parties.client }, provider: { name: "", address: v.parties.provider }, arbiter: { name: "", address: v.parties.arbiter } }, me);
        const step = nextStep({ role, agreementState: v.agreementState, nextMilestone: v.nextMilestone, milestones: v.milestones, credits: v.credits, reviewWindow: 0n, chainNow: 0n });
        return { address: v.address, title: vaultName(v).slice(0, 120), state: ["Awaiting signatures", "Awaiting funding", "Active", "Closed"][v.agreementState] ?? "Unknown", next: step.headline.replace(/^Your move: /, "").slice(0, 280), mine: step.mine, ledgerOk: v.reconcile.ok };
      }),
    };
  }, [app.role, app.names, app.chainOnline, state]);

  useEffect(() => {
    latest.current = { context, loading: state.status === "loading" };
  }, [context, state.status]);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy]);

  // "Rules (offline)" in the AI selector means: no outside service at all, for the assistant too.
  const mode: AdviceMode = app.aiMode === "rules" ? "rules" : app.aiMode === "ollama" ? "ollama" : "auto";

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      const history = [...msgs.filter((m) => m !== msgs[0]), { role: "user" as const, text: q }].map(({ role, text }) => ({ role, text })).slice(-8);
      setMsgs((m) => [...m, { role: "user", text: q }]);
      setInput("");
      setBusy(true);
      // The panel starts reading the chain when it opens: give that read a moment (up to 4 s) so the answer knows about the vaults.
      for (let i = 0; i < 40 && latest.current.loading && app.chainOnline; i++) await new Promise((r) => setTimeout(r, 100));
      const ctx = latest.current.context;
      try {
        const a = await api.assistant(history, ctx, mode);
        setMsgs((m) => [...m, { role: "assistant", text: a.reply, actions: a.actions, meta: a.meta }]);
      } catch (e) {
        // The service is down (or refused): the same rules the server uses as its own fallback, running in the browser.
        const r = ruleReply(q, ctx);
        const why = e instanceof ApiOffline ? "The AI service isn't running" : "The AI service didn't answer";
        setMsgs((m) => [...m, { role: "assistant", text: r.reply, actions: r.actions, meta: { source: "rules", model: null, latencyMs: 0, fallbackReason: `${why}. Used the built-in rules.` } }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, msgs, mode, app.chainOnline],
  );

  const run = (a: AssistantAction, key: string) => {
    switch (a.type) {
      case "navigate":
        navigate(a.to);
        break;
      case "openVault":
        navigate(`/vault/${a.address}`);
        break;
      case "setRole": {
        const i = ACCOUNT_ROLES.indexOf(a.role);
        if (i >= 0) app.setRoleIdx(i);
        break;
      }
      case "toggle":
        if (a.what === "theme") app.toggleTheme();
        else app.togglePresenter();
        break;
    }
    setDone((d) => new Set(d).add(key));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  return (
    <section className="asst" role="dialog" aria-label="Sealstone assistant" aria-modal="false">
      <header className="asst-head">
        <div>
          <b>Assistant</b>
          <span className="asst-badge" title="It suggests; you click. It can never sign, fund, approve or withdraw.">Suggests only</span>
        </div>
        <button className="asst-x" type="button" onClick={onClose} aria-label="Close the assistant">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>

      <div className="asst-log" aria-live="polite" data-testid="assistant-log">
        {msgs.map((m, i) => (
          <div key={i} className={`asst-msg ${m.role}`}>
            <p>{m.text}</p>
            {m.actions && m.actions.length > 0 && (
              <ul className="asst-actions" aria-label="Suggested next steps">
                {m.actions.map((a, j) => {
                  const key = `${i}:${j}`;
                  const used = done.has(key);
                  return (
                    <li key={key}>
                      <button type="button" className={`asst-act${used ? " done" : ""}`} onClick={() => run(a, key)} data-action={a.type}>
                        <span aria-hidden="true">{used ? "✓" : "→"}</span> {a.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {m.meta && (
              <span className="asst-meta" title={m.meta.fallbackReason ?? undefined}>
                {SOURCE_WORD[m.meta.source]}
                {m.meta.model ? ` · ${m.meta.model}` : ""}
                {m.meta.latencyMs ? ` · ${(m.meta.latencyMs / 1000).toFixed(1)} s` : ""}
                {m.meta.fallbackReason && m.meta.source === "rules" ? " · fallback" : ""}
              </span>
            )}
          </div>
        ))}
        {busy && <div className="asst-msg assistant"><p className="asst-typing" aria-label="The assistant is thinking"><i /><i /><i /></p></div>}
        <div ref={endRef} />
      </div>

      {msgs.length < 3 && (
        <div className="asst-chips">
          {STARTERS.map((s) => (
            <button key={s} type="button" onClick={() => void send(s)} disabled={busy}>{s}</button>
          ))}
        </div>
      )}

      <form className="asst-form" onSubmit={onSubmit}>
        <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about this app or your next move…" aria-label="Message the assistant" maxLength={500} />
        <button className="btn go" type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
      <p className="asst-foot">Money only moves in the vault's confirmation sheets, never through the assistant.{mode === "rules" ? " Offline mode: no outside service is used." : ""}</p>
    </section>
  );
}

export function Assistant() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return open ? <Panel onClose={close} /> : <Launcher onOpen={() => setOpen(true)} />;
}
