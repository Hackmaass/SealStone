import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useApp } from "../lib/app";
import { DEMO_CHOICE, NET, VIEWER_CHOICE, WALLET_CHOICE } from "../lib/network";
import { knownVaults } from "../lib/registry";
import { navigate } from "../lib/router";
import { KEYS, TOUR_OFF, readKey, removeKey, tourReducer, tourSeen, writeKey, type TourMode } from "../lib/onboarding";
import { disconnectWallet, reconnectSilently } from "../lib/wallet";
import { Tour } from "./Tour";
import { WalletGate, type GateChoice } from "./WalletGate";
import "./onboarding.css";

interface OnboardingApi {
  connected: boolean;
  startTour: (mode?: TourMode) => void;
  disconnect: () => void;
}

const Ctx = createContext<OnboardingApi | null>(null);

export function useOnboarding(): OnboardingApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOnboarding outside <Onboarding>");
  return v;
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

type Phase = "checking" | "gate" | "app";

/** Where the person starts, from what was remembered. "browser" needs a silent look at the wallet first; "demo" only makes sense locally. */
function firstPhase(): Phase {
  const key = readKey(KEYS.wallet);
  if (key === WALLET_CHOICE) return "checking";
  if (key === VIEWER_CHOICE && NET === "wallet") return "app";
  if (key === DEMO_CHOICE && NET === "local") return "app";
  return "gate";
}

/**
 * Wraps the whole app. Until a wallet is "connected" it shows only the connect screen; the first time in, it then starts the tour.
 * Both are remembered (localStorage, with an in-memory fallback), and neither ever changes chain state.
 *
 * The network (local test accounts vs. a real wallet on MST testnet) is fixed for the life of the page (lib/network.ts), so
 * choosing the other one stores the choice and reloads.
 */
export function Onboarding({ children }: { children: ReactNode }) {
  const app = useApp();
  const [phase, setPhase] = useState<Phase>(firstPhase);
  const [tour, dispatch] = useReducer(tourReducer, TOUR_OFF);
  const [shown, setShown] = useState(false);
  const leave = useRef(0);

  // Keep the tour mounted for a moment after it ends so it can fade out.
  useEffect(() => {
    window.clearTimeout(leave.current);
    if (tour.active) setShown(true);
    else leave.current = window.setTimeout(() => setShown(false), reduced() ? 0 : 280);
    return () => window.clearTimeout(leave.current);
  }, [tour.active]);

  const startTour = useCallback(
    (mode?: TourMode) => dispatch({ type: "start", mode, from: location.pathname, ctx: { net: NET, vault: NET === "wallet" ? (knownVaults()[0]?.address ?? null) : null } }),
    [],
  );

  // A reload after a network switch continues the first-run flow: the role that was chosen, and the tour that was due.
  useEffect(() => {
    if (phase !== "app") return;
    const role = readKey(KEYS.pendingRole);
    if (role !== null) {
      removeKey(KEYS.pendingRole);
      app.setRoleIdx(Number(role) || 0);
    }
    if (readKey(KEYS.pendingTour) === "1") {
      removeKey(KEYS.pendingTour);
      if (!tourSeen()) startTour();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // After a reload with a wallet remembered: reconnect it silently (no pop-up), or fall back to the connect screen.
  useEffect(() => {
    if (phase !== "checking") return;
    let alive = true;
    void reconnectSilently().then((ok) => {
      if (!alive) return;
      if (ok) {
        setPhase("app");
        if (!tourSeen()) startTour();
      } else {
        setPhase("gate");
      }
    });
    return () => {
      alive = false;
    };
  }, [phase, startTour]);

  const onConnect = useCallback(
    (choice: GateChoice, opts: { skipTour: boolean }) => {
      const skip = () => {
        if (opts.skipTour) writeKey(KEYS.tour, "skipped");
      };
      if (choice.kind === "demo") {
        writeKey(KEYS.wallet, DEMO_CHOICE);
        skip();
        if (NET !== "local") {
          // we are in wallet mode (a wallet was used earlier): the local chain needs the page to start in local mode
          if (!opts.skipTour) writeKey(KEYS.pendingTour, "1");
          writeKey(KEYS.pendingRole, String(choice.roleIdx));
          location.reload();
          return;
        }
        app.setRoleIdx(choice.roleIdx);
        setPhase("app");
        if (!opts.skipTour && !tourSeen()) startTour();
      } else if (choice.kind === "wallet") {
        writeKey(KEYS.wallet, WALLET_CHOICE);
        if (NET !== "wallet") {
          // a wallet was connected on localhost: the page must start in wallet mode to read MST testnet
          writeKey(KEYS.pendingTour, "1");
          location.reload();
          return;
        }
        setPhase("app");
        if (!tourSeen()) startTour();
      } else {
        writeKey(KEYS.wallet, VIEWER_CHOICE);
        skip();
        if (NET !== "wallet") {
          location.reload();
          return;
        }
        setPhase("app");
      }
    },
    [app, startTour],
  );

  const stop = useCallback(
    (how: "done" | "skipped", to?: string) => {
      writeKey(KEYS.tour, how);
      dispatch({ type: "stop" });
      navigate(to ?? tour.returnTo ?? "/dashboard");
    },
    [tour.returnTo],
  );

  const disconnect = useCallback(() => {
    disconnectWallet();
    removeKey(KEYS.wallet);
    dispatch({ type: "stop" });
    setPhase("gate");
  }, []);

  // "?" replays the tour from anywhere (ignored while typing).
  useEffect(() => {
    if (phase !== "app") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.matches("input,textarea,select") || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?" && !tour.active) startTour();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, tour.active, startTour]);

  const api = useMemo<OnboardingApi>(() => ({ connected: phase === "app", startTour, disconnect }), [phase, startTour, disconnect]);

  if (phase === "checking") {
    return (
      <div className="og-splash" role="status" aria-live="polite" data-testid="wallet-checking">
        <span className="og-spin" aria-hidden="true" />
        Reconnecting your wallet…
      </div>
    );
  }
  if (phase === "gate") return <Ctx.Provider value={api}><WalletGate onConnect={onConnect} /></Ctx.Provider>;
  return (
    <Ctx.Provider value={api}>
      {children}
      {shown && <Tour state={tour} dispatch={dispatch} onStop={stop} leaving={!tour.active} />}
    </Ctx.Provider>
  );
}
