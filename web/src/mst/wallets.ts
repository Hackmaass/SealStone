import type { Eip1193Provider } from "ethers";

export type Wallet = { id: string; name: string; provider: Eip1193Provider; source: string };

const isProvider = (x: unknown): x is Eip1193Provider => typeof x === "object" && x !== null && typeof (x as { request?: unknown }).request === "function";

/** window properties that could plausibly be a wallet object even though they are not window.ethereum. */
const WALLET_KEY = /bridge|mst|wallet|ethereum|web3|provider/i;

/**
 * Finds wallet providers a page can reach WITHOUT the EIP-6963 announcements: window.ethereum, the `providers` array some
 * extensions use when several are installed, and any window property whose name looks wallet-like and has a request().
 * Pure (takes the window object), so it is unit-tested.
 */
export function scanInjected(win: Record<string, unknown>): Wallet[] {
  const found = new Map<unknown, Wallet>();
  const add = (provider: unknown, name: string, source: string) => {
    if (isProvider(provider) && !found.has(provider)) found.set(provider, { id: `inj:${source}`, name, provider, source });
  };
  const eth = win.ethereum;
  add(eth, nameOf(eth) ?? "Browser wallet (window.ethereum)", "window.ethereum");
  const list = (eth as { providers?: unknown } | undefined)?.providers;
  if (Array.isArray(list)) list.forEach((p, i) => add(p, nameOf(p) ?? `Wallet ${i + 1} (window.ethereum.providers)`, `window.ethereum.providers[${i}]`));
  for (const key of Object.keys(win)) {
    if (key === "ethereum" || !WALLET_KEY.test(key)) continue;
    let value: unknown;
    try {
      value = win[key];
    } catch {
      continue;
    }
    add(value, `${key} (window.${key})`, `window.${key}`);
    add((value as { ethereum?: unknown } | undefined)?.ethereum, `${key} (window.${key}.ethereum)`, `window.${key}.ethereum`);
    add((value as { provider?: unknown } | undefined)?.provider, `${key} (window.${key}.provider)`, `window.${key}.provider`);
  }
  return [...found.values()];
}

function nameOf(p: unknown): string | undefined {
  const o = p as { isMetaMask?: boolean; isBridgeKey?: boolean; isBridgekey?: boolean } | undefined;
  if (o?.isBridgeKey || o?.isBridgekey) return "BridgeKey (window.ethereum)";
  if (o?.isMetaMask) return "MetaMask (window.ethereum)";
  return undefined;
}

/** Names of window properties that look wallet-related, for the diagnostics panel (names only, never values). */
export function walletLikeKeys(win: Record<string, unknown>): string[] {
  return Object.keys(win).filter((k) => WALLET_KEY.test(k));
}
