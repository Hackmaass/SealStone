import { useSyncExternalStore } from "react";
import { BrowserProvider, getAddress, type Eip1193Provider, type JsonRpcSigner } from "ethers";
import { scanInjected } from "../mst/wallets";
import { MST } from "./mstNetwork";
import { readKey, removeKey, writeKey } from "./onboarding";

/**
 * The visitor's own browser wallet (MetaMask, BridgeKey, ...), used only in "wallet" mode on the MST testnet (lib/network.ts).
 * Rules this file keeps:
 *  - `eth_requestAccounts` (the connect pop-up) is only ever called from `connectWallet`, which the UI calls from a click.
 *    On a reload the wallet is reconnected with `eth_accounts`, which never opens anything.
 *  - Only MST testnet (chainId 91562037) is ever requested. Mainnet cannot be named here.
 *  - Every transaction is signed by the wallet itself (`walletSigner`), after checking that the wallet is on MST and on the
 *    account the action needs, so a wrong account never costs gas on a role revert.
 */

export interface WalletInfo {
  /** stable across reloads: the EIP-6963 reverse-DNS name when there is one */
  id: string;
  name: string;
  icon?: string;
  provider: Eip1193Provider;
}

export type WalletErrorCode = "no-wallet" | "wrong-account" | "wrong-network" | "rejected" | "pending" | "unavailable";

export class WalletError extends Error {
  readonly code: WalletErrorCode;
  readonly expected?: string;
  constructor(code: WalletErrorCode, message: string, expected?: string) {
    super(message);
    this.name = "WalletError";
    this.code = code;
    this.expected = expected;
  }
}

export interface WalletState {
  wallet: WalletInfo | null;
  account: string | null;
  chainId: number | null;
  status: "idle" | "connecting" | "connected";
  error: string | null;
}

export const WALLET_ID_KEY = "mv.onboard.walletId";

let state: WalletState = { wallet: null, account: null, chainId: null, status: "idle", error: null };
const subscribers = new Set<() => void>();
const set = (patch: Partial<WalletState>): void => {
  state = { ...state, ...patch };
  subscribers.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subscribers.add(f);
  return () => void subscribers.delete(f);
};
export const walletState = (): WalletState => state;
export const useWalletState = (): WalletState => useSyncExternalStore(subscribe, walletState);

export const onMst = (s: WalletState = state): boolean => s.chainId === MST.chainId;

// ───────────────────────── finding wallets (passive: nothing is requested) ─────────────────────────
const found = new Map<string, WalletInfo>();
let list: WalletInfo[] = [];
const listSubscribers = new Set<() => void>();
let discovering = false;

function publish(): void {
  list = [...found.values()];
  listSubscribers.forEach((f) => f());
}

function add(info: WalletInfo, announced: boolean): void {
  const same = [...found.values()].find((w) => w.provider === info.provider);
  if (same) {
    if (!announced) return; // already known; an announcement has the better name and id, so it replaces a guess
    found.delete(same.id);
  }
  found.set(info.id, info);
  publish();
}

const cleanName = (n: string) => n.replace(/\s*\(window[^)]*\)/, "");

export function startDiscovery(): void {
  if (discovering || typeof window === "undefined") return;
  discovering = true;
  window.addEventListener("eip6963:announceProvider", (e) => {
    const d = (e as CustomEvent<{ info?: { uuid?: string; rdns?: string; name?: string; icon?: string }; provider?: Eip1193Provider }>).detail;
    if (d?.info?.name && d.provider) add({ id: d.info.rdns || d.info.uuid || d.info.name, name: d.info.name, icon: d.info.icon, provider: d.provider }, true);
  });
  const scan = () => {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    for (const w of scanInjected(window as unknown as Record<string, unknown>)) add({ id: w.id, name: cleanName(w.name), provider: w.provider }, false);
  };
  scan();
  window.addEventListener("ethereum#initialized", scan);
  window.addEventListener("load", scan);
  // some extensions inject a moment after the page loads: look again for a few seconds, then stop
  let n = 0;
  const t = window.setInterval(() => {
    scan();
    if (++n >= 20) window.clearInterval(t);
  }, 500);
}

export function rescanWallets(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  for (const w of scanInjected(window as unknown as Record<string, unknown>)) add({ id: w.id, name: cleanName(w.name), provider: w.provider }, false);
}

export function useWallets(): WalletInfo[] {
  startDiscovery();
  return useSyncExternalStore(
    (f) => {
      listSubscribers.add(f);
      return () => void listSubscribers.delete(f);
    },
    () => list,
  );
}

// ───────────────────────── connecting ─────────────────────────
type Emitter = { on?: (e: string, f: (...a: never[]) => void) => void; removeListener?: (e: string, f: (...a: never[]) => void) => void };
let detach: (() => void) | null = null;

/** Turns what a wallet throws into one plain sentence. */
export function explainWalletError(e: unknown): string {
  const err = e as { code?: number | string; message?: string; info?: { error?: { code?: number } } };
  const code = err.info?.error?.code ?? err.code;
  if (code === 4001 || code === "ACTION_REJECTED") return "You closed the request in your wallet, so nothing was sent.";
  if (code === -32002) return "Your wallet already has a request open. Open the wallet and answer it.";
  if (code === 4100) return "Your wallet hasn't allowed this site yet. Connect it first.";
  if (e instanceof WalletError) return e.message;
  return (err.message ?? "The wallet reported an error.").slice(0, 200);
}

const hexToNumber = (h: unknown): number | null => (typeof h === "string" && /^0x[0-9a-f]+$/i.test(h) ? Number.parseInt(h, 16) : null);

/** Switches the wallet to MST testnet, adding the network first if the wallet doesn't know it. The user approves each step. */
export async function switchToMst(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: MST.chainIdHex }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    const message = String((e as { message?: string }).message ?? "");
    // 4902 is the standard "unknown chain"; some wallets answer -32603 with a message instead
    if (code !== 4902 && !/unrecognized chain|unknown chain|not added|add the chain/i.test(message)) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: MST.chainIdHex, chainName: MST.name, rpcUrls: [MST.rpc], nativeCurrency: { name: MST.symbol, symbol: MST.symbol, decimals: 18 }, blockExplorerUrls: [MST.explorer] }],
    });
  }
}

function attach(wallet: WalletInfo, account: string, chainId: number | null): void {
  detach?.();
  const p = wallet.provider as unknown as Emitter;
  const onAccounts = (accounts: string[]) => {
    const next = accounts?.[0] ? getAddress(accounts[0]) : null;
    set({ account: next, status: next ? "connected" : "idle" });
  };
  const onChain = (hex: string) => set({ chainId: hexToNumber(hex) });
  p.on?.("accountsChanged", onAccounts as never);
  p.on?.("chainChanged", onChain as never);
  detach = () => {
    p.removeListener?.("accountsChanged", onAccounts as never);
    p.removeListener?.("chainChanged", onChain as never);
  };
  set({ wallet, account: getAddress(account), chainId, status: "connected", error: null });
}

/** The connect pop-up. Call this only from a click. */
export async function connectWallet(wallet: WalletInfo): Promise<string> {
  set({ status: "connecting", error: null });
  try {
    const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts?.length) throw new WalletError("rejected", "The wallet didn't share an account.");
    await switchToMst(wallet.provider);
    const chainId = hexToNumber(await wallet.provider.request({ method: "eth_chainId" }));
    attach(wallet, accounts[0], chainId);
    writeKey(WALLET_ID_KEY, wallet.id);
    return getAddress(accounts[0]);
  } catch (e) {
    set({ status: "idle", error: explainWalletError(e) });
    throw e;
  }
}

/**
 * After a reload: find the wallet that was connected last time and ask it for its accounts WITHOUT a pop-up (`eth_accounts`).
 * Returns false if the wallet isn't there, is locked, or no longer lets this site see an account.
 */
export async function reconnectSilently(timeoutMs = 2500): Promise<boolean> {
  const id = readKey(WALLET_ID_KEY);
  if (!id) return false;
  startDiscovery();
  const t0 = Date.now();
  let wallet: WalletInfo | undefined;
  while (Date.now() - t0 < timeoutMs) {
    wallet = found.get(id) ?? [...found.values()].find((w) => w.name === id);
    if (wallet) break;
    rescanWallets();
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!wallet) return false;
  try {
    const accounts = (await wallet.provider.request({ method: "eth_accounts" })) as string[];
    if (!accounts?.length) return false;
    attach(wallet, accounts[0], hexToNumber(await wallet.provider.request({ method: "eth_chainId" })));
    return true;
  } catch {
    return false;
  }
}

export function disconnectWallet(): void {
  const wallet = state.wallet;
  detach?.();
  detach = null;
  removeKey(WALLET_ID_KEY);
  set({ wallet: null, account: null, chainId: null, status: "idle", error: null });
  // ask the wallet to forget this site where it supports that (MetaMask does); ignore anything else
  void (wallet?.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }) as Promise<unknown> | undefined)?.catch(() => undefined);
}

/** A click on "Switch to MST Testnet". */
export async function switchWalletToMst(): Promise<void> {
  if (!state.wallet) throw new WalletError("no-wallet", "Connect a wallet first.");
  try {
    await switchToMst(state.wallet.provider);
    set({ chainId: hexToNumber(await state.wallet.provider.request({ method: "eth_chainId" })), error: null });
  } catch (e) {
    set({ error: explainWalletError(e) });
    throw e;
  }
}

/**
 * The signer for a transaction. The wallet pops up its own confirmation for each one.
 * `expected` is the account the action must come from (the client to fund, the provider to submit, ...).
 */
export async function walletSigner(expected?: string): Promise<JsonRpcSigner> {
  const wallet = state.wallet;
  if (!wallet || !state.account) throw new WalletError("no-wallet", "Connect a wallet first (top right), then try again.");
  const chainId = hexToNumber(await wallet.provider.request({ method: "eth_chainId" }));
  if (chainId !== MST.chainId) {
    set({ chainId });
    throw new WalletError("wrong-network", `Your wallet is on another network. Switch it to ${MST.name} (chainId ${MST.chainId}) and try again.`);
  }
  const signer = await new BrowserProvider(wallet.provider, MST.chainId).getSigner();
  const actual = getAddress(await signer.getAddress());
  if (actual !== state.account) set({ account: actual });
  if (expected && getAddress(expected) !== actual) {
    throw new WalletError("wrong-account", `This step needs the account ${short(expected)}, but your wallet is on ${short(actual)}. Switch accounts in your wallet and try again.`, getAddress(expected));
  }
  return signer;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
