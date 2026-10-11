import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./app";
import { loadVaultSummaries, type VaultSummary } from "./vaultList";

export type VaultListState = { status: "loading" } | { status: "ready"; list: VaultSummary[] } | { status: "error"; message: string };

/** Every real vault on the chain, refreshed whenever the block changes (at most once a second). */
export function useVaultList(): { state: VaultListState; refresh: () => void } {
  const app = useApp();
  const [state, setState] = useState<VaultListState>({ status: "loading" });
  const seq = useRef(0);
  const alive = useRef(true);
  const last = useRef(0);
  const failures = useRef(0);

  const refresh = useCallback(() => {
    const mine = ++seq.current;
    last.current = Date.now();
    loadVaultSummaries()
      .then((list) => {
        failures.current = 0;
        if (alive.current && mine === seq.current) setState({ status: "ready", list });
      })
      .catch((e: Error) => {
        if (!alive.current || mine !== seq.current) return;
        // A single refused request is common on some machines: retry quietly (0.6 s, 1.2 s, 2.4 s) before showing an error.
        if (++failures.current <= 3) {
          setTimeout(refresh, 600 * 2 ** (failures.current - 1));
          return;
        }
        setState((cur) => (cur.status === "ready" ? cur : { status: "error", message: e.message }));
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const wait = Math.max(0, 900 - (Date.now() - last.current));
    const t = setTimeout(refresh, wait);
    return () => clearTimeout(t);
  }, [refresh, app.block]);

  return { state, refresh };
}
