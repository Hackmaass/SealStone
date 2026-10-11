import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch } from "react";
import { useApp } from "../lib/app";
import { navigate } from "../lib/router";
import { chaptersFor, isLast, stepsFor, type StepIcon, type TourAction, type TourCtx, type TourState } from "../lib/onboarding";
import deployment from "../generated/deployment.json";
import { HashSeal } from "./components";

const ROLE_WORD = { client: "Client", provider: "Provider", arbiter: "Arbiter", stranger: "Anyone" } as const;
const PAD = 8;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The first match that is actually on screen: on a phone the sidebar control is hidden and its phone twin is the visible one. */
function firstVisible(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

const sameBox = (a: Box | null, b: Box | null) => (a === b) || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

/** Small line icons, drawn here so nothing is fetched. */
function Icon({ name }: { name: StepIcon }) {
  const p: Record<StepIcon, string> = {
    welcome: "M12 3l2.6 5.6L21 9.5l-4.5 4.3 1.1 6.2L12 17l-5.6 3 1.1-6.2L3 9.5l6.4-.9z",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-3.5 3.6-6 8-6s8 2.5 8 6",
    ai: "M12 3v3M12 18v3M3 12h3M18 12h3M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2M9 9h6v6H9z",
    chain: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    keys: "M4 7h16v10H4zM7 10.5h.01M10.5 10.5h.01M14 10.5h.01M17 10.5h.01M8 14h8",
    money: "M4 7h16v11H4zM4 7l3-3h10l3 3M12 10.5v4M10 12h4",
    list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
    steps: "M5 5h4v4H5zM15 9h4v4h-4zM5 15h4v4H5zM9 7h6M17 13v2h-6",
    paste: "M8 4h8v3H8zM6 6h12v15H6zM9 12h6M9 16h6",
    seal: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
    move: "M5 12h14M13 6l6 6-6 6",
    file: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
    verify: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5L16 9.5",
    ledger: "M4 20V10M10 20V4M16 20v-8M22 20H2",
    withdraw: "M12 4v12M7 11l5 5 5-5M5 20h14",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 9l6 6M15 9l-6 6",
    duel: "M7 5v14M17 5v14M4 9h6M14 15h6",
    done: "M5 12.5l4.5 4.5L19 7.5",
  };
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={p[name]} />
    </svg>
  );
}

/** What is true right now, shown in the card so the explanation is about the person's own screen. */
function Live({ id }: { id: string }) {
  const app = useApp();
  if (id === "roles") {
    return (
      <div className="tour-live" aria-live="polite">
        <span className="tour-dot" /> Acting as <b>{ROLE_WORD[app.role]}</b> · {app.names[app.role]}
      </div>
    );
  }
  if (id === "ai") {
    const label = { auto: "Auto", ollama: "Ollama", gemini: "Gemini", rules: "Rules (offline)" }[app.aiMode];
    return (
      <div className="tour-live" aria-live="polite">
        <span className={`tour-dot${app.serverOnline === false ? " off" : ""}`} /> AI mode: <b>{label}</b> · AI service {app.serverOnline === null ? "checking" : app.serverOnline ? "online" : "offline (the built-in rules still work)"}
      </div>
    );
  }
  if (id === "chain") {
    return (
      <div className="tour-live" aria-live="polite">
        <span className={`tour-dot${app.chainOnline ? "" : " off"}`} /> {app.chainOnline ? <>Local chain online · block <b className="mono">{app.block ?? "…"}</b></> : "Local chain not reachable (start it with npm run dev)"}
      </div>
    );
  }
  return null;
}

function Welcome({ dispatch, onSkip, quickStops }: { dispatch: Dispatch<TourAction>; onSkip: () => void; quickStops: number }) {
  return (
    <div className="tour-hero">
      <div className="tour-hero-seal" aria-hidden="true">
        <HashSeal hash={deployment.preseededVault.agreementHash} state="onchain" size={132} draw />
      </div>
      <div className="tour-choices">
        <button className="btn go" type="button" onClick={() => dispatch({ type: "next" })} data-testid="tour-full">
          Take the full tour <span className="tour-faint">· about 3 min</span>
        </button>
        <button className="btn secondary" type="button" onClick={() => { dispatch({ type: "mode", mode: "quick" }); dispatch({ type: "next" }); }} data-testid="tour-quick">
          Quick tour <span className="tour-faint">· {quickStops} stops</span>
        </button>
        <button className="linklike" type="button" onClick={onSkip} data-testid="tour-skip-welcome">
          Skip, I'll explore
        </button>
      </div>
    </div>
  );
}

function Finish({ onGo, onClose, ctx }: { onGo: (to: string) => void; onClose: () => void; ctx: TourCtx }) {
  const doors: Array<[string, string, string]> =
    ctx.net === "wallet"
      ? [
          ["Draft an agreement", "Paste text, let the AI propose, resolve, seal", "/agreement"],
          ["Your vaults", "Open one you made, or add one by its address", "/vaults"],
          ["The dashboard", "Totals, and what needs your move", "/dashboard"],
        ]
      : [
          ["Open the demo vault", "Walk a live agreement as each role", `/vault/${deployment.preseededVault.address}`],
          ["Run the 12 attacks", "Fire real transactions at the contract", "/attack-lab"],
          ["Draft an agreement", "Paste text, let the AI propose, resolve, seal", "/agreement"],
        ];
  return (
    <div className="tour-finish">
      <div className="tour-stamp" aria-hidden="true">
        <svg viewBox="0 0 100 100" width="96" height="96">
          <circle className="ring" cx="50" cy="50" r="38" />
          <path className="tick" d="M32 51l12 12 24-26" />
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} className="ray" x1="50" y1="6" x2="50" y2="14" transform={`rotate(${i * 30} 50 50)`} style={{ ["--i" as string]: i } as CSSProperties} />
          ))}
        </svg>
      </div>
      <div className="tour-doors">
        {doors.map(([t, s, to], i) => (
          <button key={to} className="tour-door" type="button" style={{ ["--i" as string]: i } as CSSProperties} onClick={() => onGo(to)} data-testid={`tour-go-${i}`}>
            <b>{t}</b>
            <span>{s}</span>
          </button>
        ))}
      </div>
      <p className="tour-keys">
        <kbd>1</kbd>–<kbd>4</kbd> roles · <kbd>P</kbd> presenter · <kbd>T</kbd> theme · <kbd>?</kbd> replay this tour
      </p>
      <button className="linklike" type="button" onClick={onClose}>Close</button>
    </div>
  );
}

interface Props {
  state: TourState;
  dispatch: Dispatch<TourAction>;
  /** the person is finished (or left): remember it and put them back */
  onStop: (how: "done" | "skipped", to?: string) => void;
  leaving: boolean;
}

export function Tour({ state, dispatch, onStop, leaving }: Props) {
  const steps = stepsFor(state.mode, state.ctx);
  const step = steps[state.index];
  const [box, setBox] = useState<Box | null>(null);
  const [phase, setPhase] = useState<"seeking" | "found" | "missing">("seeking");
  const [pos, setPos] = useState<CSSProperties>({});
  const [phone, setPhone] = useState(() => innerWidth <= 720);
  const target = useRef<HTMLElement | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const modal = !!step.modal;

  const measure = useCallback(() => {
    const el = target.current;
    if (!el || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    const next: Box = { top: r.top, left: r.left, width: r.width, height: r.height };
    setBox((cur) => (sameBox(cur, next) ? cur : next));
  }, []);

  // Go to the step's page, then wait for the real element to show up.
  useEffect(() => {
    setBox(null);
    target.current = null;
    if (!step.anchor) {
      setPhase("found");
    } else {
      setPhase("seeking");
    }
    const to = step.route?.(state.ctx) ?? null;
    if (to && location.pathname !== to) navigate(to);
    if (!step.anchor) return;
    let stop = false;
    const t0 = performance.now();
    let timer = 0;
    const seek = () => {
      if (stop) return;
      const el = firstVisible(step.anchor as string);
      if (el) {
        target.current = el;
        el.scrollIntoView({ block: innerWidth <= 720 ? "start" : "center", behavior: reduced() ? "auto" : "smooth" });
        setPhase("found");
        measure();
        return;
      }
      if (performance.now() - t0 > 5000) {
        setPhase("missing");
        return;
      }
      timer = window.setTimeout(seek, 120);
    };
    seek();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [step.id, state.mode, state.ctx, step.anchor, step.route, measure]);

  // Follow the element while it moves (smooth scroll, data arriving, the window resizing).
  useEffect(() => {
    if (phase !== "found" || !step.anchor) return;
    const on = () => {
      setPhone(innerWidth <= 720);
      measure();
    };
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    const iv = window.setInterval(measure, 250);
    return () => {
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
      window.clearInterval(iv);
    };
  }, [phase, step.anchor, measure]);

  // The hole around the element, kept inside the window.
  const vw = typeof innerWidth === "number" ? innerWidth : 1280;
  const vh = typeof innerHeight === "number" ? innerHeight : 800;
  const hole = box && phase === "found" && !modal
    ? (() => {
        const top = Math.max(6, box.top - PAD);
        const left = Math.max(6, box.left - PAD);
        const bottom = Math.min(vh - 6, box.top + box.height + PAD);
        const right = Math.min(vw - 6, box.left + box.width + PAD);
        return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      })()
    : null;

  // Put the card beside the hole where there is room; centre it when there is nothing to point at.
  useLayoutEffect(() => {
    const c = card.current;
    if (!c || phone) {
      setPos({});
      return;
    }
    const W = c.offsetWidth;
    const H = c.offsetHeight;
    const gap = 18;
    const m = 16;
    const clampX = (x: number) => Math.max(m, Math.min(vw - W - m, x));
    const clampY = (y: number) => Math.max(m, Math.min(vh - H - m, y));
    if (!hole) {
      setPos({ top: clampY((vh - H) / 2), left: clampX((vw - W) / 2) });
    } else if (hole.top + hole.height + gap + H <= vh - m) {
      setPos({ top: hole.top + hole.height + gap, left: clampX(hole.left) });
    } else if (hole.top - gap - H >= m) {
      setPos({ top: hole.top - gap - H, left: clampX(hole.left) });
    } else if (hole.left + hole.width + gap + W <= vw - m) {
      setPos({ top: clampY(hole.top), left: hole.left + hole.width + gap });
    } else if (hole.left - gap - W >= m) {
      setPos({ top: clampY(hole.top), left: hole.left - gap - W });
    } else {
      setPos({ top: vh - H - m, left: vw - W - m }); // a very large target: tuck the card into the corner
    }
  }, [hole?.top, hole?.left, hole?.width, hole?.height, step.id, phase, phone, vw, vh, state.mode, modal]);

  // Focus the card on each step, and keep keyboard use inside it.
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
  }, [step.id]);

  const skip = useCallback(() => onStop("skipped"), [onStop]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const onControl = !!t && !!t.closest("button,a,input,select,textarea");
      if (e.key === "Escape") {
        e.preventDefault();
        skip();
      } else if (e.key === "ArrowRight" && !isLast(state)) {
        e.preventDefault();
        dispatch({ type: "next" });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        dispatch({ type: "back" });
      } else if (e.key === "Enter" && !onControl && !isLast(state) && step.id !== "welcome") {
        e.preventDefault();
        dispatch({ type: "next" });
      } else if (e.key === "Tab") {
        const els = [...(card.current?.querySelectorAll<HTMLElement>("button,a[href],input,select") ?? [])].filter((x) => !x.hasAttribute("disabled"));
        if (!els.length) return;
        const firstEl = els[0];
        const lastEl = els[els.length - 1];
        if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === card.current)) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        } else if (!card.current?.contains(document.activeElement)) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, step.id, dispatch, skip]);

  const chapters = chaptersFor(state.mode, state.ctx);
  const body = phone && step.phoneBody ? step.phoneBody : step.body;
  const headingId = "tour-title";
  const holeStyle: CSSProperties = hole
    ? { top: hole.top, left: hole.left, width: hole.width, height: hole.height }
    : { top: vh / 2, left: vw / 2, width: 0, height: 0 };

  return (
    <div className={`tour${leaving ? " leaving" : ""}`} data-testid="tour" data-step={step.id} data-phase={phase}>
      <div className="tour-block" aria-hidden="true" />
      <div className={`tour-hole${hole ? " on" : ""}`} style={holeStyle} aria-hidden="true" />
      <div className="tour-sr" role="status" aria-live="polite">{`Step ${state.index + 1} of ${steps.length}: ${step.title}`}</div>

      <div
        ref={card}
        className={`tour-card${modal ? " modal" : ""}${phone ? " sheet" : ""}`}
        style={phone ? undefined : pos}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        data-testid="tour-card"
      >
        <div className="tour-inner" key={step.id}>
        <div className="tour-top">
          <span className="tour-chip">
            <Icon name={step.icon} />
            {step.chapter}
          </span>
          <span className="tour-count" aria-hidden="true">{state.index + 1} / {steps.length}</span>
          {step.id !== "welcome" && !modal && (
            <button className="tour-x" type="button" onClick={skip} aria-label="Close the tour" title="Close (Esc)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          )}
        </div>

        <div className="tour-bar" aria-hidden="true">
          {chapters.map((c) => {
            const done = Math.max(0, Math.min(c.count, state.index - c.first + 1));
            return (
              <span key={c.name} className="tour-seg" style={{ flex: c.count }}>
                <i style={{ width: `${(done / c.count) * 100}%` }} />
              </span>
            );
          })}
        </div>

        <h2 id={headingId} className="tour-title">{step.title}</h2>
        <p className="tour-body">{body}</p>
        {phase === "missing" && !modal && <p className="tour-miss">This part isn't on screen right now, so here's the idea without the spotlight.</p>}

        {step.points && step.id !== "welcome" && (
          <dl className="tour-points">
            {step.points.map((p, i) => (
              <div key={p.k} style={{ ["--i" as string]: i } as CSSProperties}>
                <dt>{p.k}</dt>
                <dd>{p.v}</dd>
              </div>
            ))}
          </dl>
        )}
        {step.id === "welcome" && step.points && (
          <ul className="tour-layers">
            {step.points.map((p, i) => (
              <li key={p.k} style={{ ["--i" as string]: i } as CSSProperties}>
                <b>{p.k}</b>
                <span>{p.v}</span>
              </li>
            ))}
          </ul>
        )}
        <Live id={step.id} />
        {step.note && <p className="tour-note">{step.note}</p>}

        {step.id === "welcome" && <Welcome dispatch={dispatch} onSkip={skip} quickStops={stepsFor("quick", state.ctx).length - 2} />}
        {step.id === "done" && <Finish ctx={state.ctx} onGo={(to) => { onStop("done", to); }} onClose={() => onStop("done")} />}

        {step.id !== "welcome" && step.id !== "done" && (
          <div className="tour-foot">
            <button className="btn secondary" type="button" onClick={() => dispatch({ type: "back" })} disabled={state.index === 0}>Back</button>
            <button className="linklike" type="button" onClick={skip}>Skip tour</button>
            <button className="btn go" type="button" onClick={() => dispatch({ type: "next" })} data-testid="tour-next">
              {steps[state.index + 1]?.id === "done" ? "Finish" : "Next"}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
