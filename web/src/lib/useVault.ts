import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./app";
import { loadVault, type VaultSnapshot } from "./vaultData";

export type VaultLoad = { status: "loading" } | { status: "missing" } | { status: "error"; message: string } | { status: "ready"; snapshot: VaultSnapshot };

/**
 * Keeps one vault snapshot fresh. Re-reads whenever the block number CHANGES (not only when it grows: a demo reset
 * sends it backwards) and on demand after our own transactions. A sequence number stops a slow older read from
 * overwriting a newer one.
 */
export function useVault(address: string): { load: VaultLoad; refresh: () => Promise<void> } {
  const app = useApp();
  const [load, setLoad] = useState<VaultLoad>({ status: "loading" });
  const seq = useRef(0);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await loadVault(address);
      if (!alive.current || mine !== seq.current) return;
      setLoad(r.kind === "missing" ? { status: "missing" } : { status: "ready", snapshot: r.snapshot });
    } catch (e) {
      if (!alive.current || mine !== seq.current) return;
      // Keep showing the last good snapshot if the chain hiccups; only show an error when there is nothing to show.
      setLoad((cur) => (cur.status === "ready" ? cur : { status: "error", message: (e as Error).message }));
    }
  }, [address]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setLoad({ status: "loading" });
  }, [address]);
  useEffect(() => {
    void refresh();
  }, [refresh, app.block]);

  return { load, refresh };
}
