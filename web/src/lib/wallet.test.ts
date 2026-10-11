import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Eip1193Provider } from "ethers";
import { MST } from "./mstNetwork";
import { DEMO_CHOICE, VIEWER_CHOICE, WALLET_CHOICE, detectNet } from "./network";
import { KEYS, readKey, removeKey, writeKey } from "./onboarding";
import { forgetVault, knownVaults, parseVaultAddress, rememberVault } from "./registry";
import { WALLET_ID_KEY, WalletError, connectWallet, disconnectWallet, explainWalletError, onMst, reconnectSilently, walletSigner, walletState, type WalletInfo } from "./wallet";

const ACCOUNT_A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ACCOUNT_B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

/** A wallet that records every call and answers like a real one. `chain` and `account` can be changed mid-test, like a person would. */
function fakeWallet(opts: { unknownChain?: boolean; accounts?: string[]; chainId?: number } = {}) {
  const calls: Array<{ method: string; params?: unknown }> = [];
  const s = { chainId: opts.chainId ?? 1, accounts: opts.accounts ?? [ACCOUNT_A], knowsMst: !opts.unknownChain };
  const provider = {
    async request({ method, params }: { method: string; params?: unknown }) {
      calls.push({ method, params });
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return s.accounts;
        case "eth_chainId":
          return "0x" + s.chainId.toString(16);
        case "wallet_switchEthereumChain": {
          const want = Number.parseInt((params as Array<{ chainId: string }>)[0].chainId, 16);
          if (want === MST.chainId && !s.knowsMst) throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
          s.chainId = want;
          return null;
        }
        case "wallet_addEthereumChain":
          s.knowsMst = true;
          s.chainId = Number.parseInt((params as Array<{ chainId: string }>)[0].chainId, 16);
          return null;
        case "wallet_revokePermissions":
          return null;
        case "net_version":
          return String(s.chainId);
        default:
          throw new Error(`unexpected ${method}`);
      }
    },
  } as unknown as Eip1193Provider;
  const info: WalletInfo = { id: "test.wallet", name: "Test Wallet", provider };
  return { info, calls, s, methods: () => calls.map((c) => c.method) };
}

describe("which network the page uses", () => {
  it("is the local chain on localhost unless a browser wallet was chosen, and the wallet everywhere else", () => {
    expect(detectNet(false, null)).toBe("local");
    expect(detectNet(false, DEMO_CHOICE)).toBe("local");
    expect(detectNet(false, WALLET_CHOICE)).toBe("wallet");
    expect(detectNet(false, VIEWER_CHOICE)).toBe("wallet");
    expect(detectNet(true, null)).toBe("wallet");
    expect(detectNet(true, DEMO_CHOICE)).toBe("wallet"); // a hosted copy has no local chain, whatever was remembered
  });
});

describe("the wallet connection", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  });
  afterEach(() => {
    disconnectWallet();
    vi.unstubAllGlobals();
  });

  it("asks for accounts and then switches to MST testnet, and never names any other network", async () => {
    const w = fakeWallet();
    await expect(connectWallet(w.info)).resolves.toBe(ACCOUNT_A);
    expect(w.methods()).toEqual(["eth_requestAccounts", "wallet_switchEthereumChain", "eth_chainId"]);
    const switchParams = w.calls[1].params as Array<{ chainId: string }>;
    expect(switchParams[0].chainId).toBe("0x5752035");
    expect(walletState()).toMatchObject({ status: "connected", account: ACCOUNT_A, chainId: MST.chainId });
    expect(onMst()).toBe(true);
    // mainnet (chainId 4646 = 0x1226) must not be representable anywhere in what the app asks a wallet
    expect(JSON.stringify(w.calls)).not.toMatch(/0x1226|4646/);
  });

  it("adds MST testnet to a wallet that doesn't know it, with the right network details", async () => {
    const w = fakeWallet({ unknownChain: true });
    await connectWallet(w.info);
    expect(w.methods()).toEqual(["eth_requestAccounts", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_chainId"]);
    const add = (w.calls[2].params as Array<Record<string, unknown>>)[0];
    expect(add).toMatchObject({ chainId: "0x5752035", chainName: "MST Testnet", rpcUrls: ["https://testnetrpc.mstblockchain.com"], nativeCurrency: { symbol: "tMSTC", decimals: 18 } });
  });

  it("says plainly when the person closes the wallet's pop-up, and stays disconnected", async () => {
    const w = fakeWallet();
    w.info.provider.request = (async () => {
      throw Object.assign(new Error("User rejected the request."), { code: 4001 });
    }) as never;
    await expect(connectWallet(w.info)).rejects.toBeTruthy();
    expect(walletState().status).toBe("idle");
    expect(walletState().error).toMatch(/closed the request in your wallet/i);
  });

  it("reconnects after a reload with eth_accounts only: no pop-up, no connect request", async () => {
    const w = fakeWallet({ chainId: MST.chainId });
    // a window the wallet can announce itself on, as an extension does
    const win = new EventTarget();
    vi.stubGlobal("window", Object.assign(win, { setInterval, clearInterval }));
    win.addEventListener("eip6963:requestProvider", () => win.dispatchEvent(Object.assign(new Event("eip6963:announceProvider"), { detail: { info: { uuid: "u", rdns: "test.wallet", name: "Test Wallet" }, provider: w.info.provider } })));
    writeKey(WALLET_ID_KEY, "test.wallet");
    await expect(reconnectSilently(1500)).resolves.toBe(true);
    expect(w.methods()).not.toContain("eth_requestAccounts");
    expect(w.methods()).toContain("eth_accounts");
    expect(walletState().account).toBe(ACCOUNT_A);
  });

  it("does not reconnect (and does not prompt) when the wallet no longer shares an account", async () => {
    const w = fakeWallet({ accounts: [], chainId: MST.chainId });
    const win = new EventTarget();
    vi.stubGlobal("window", Object.assign(win, { setInterval, clearInterval }));
    win.addEventListener("eip6963:requestProvider", () => win.dispatchEvent(Object.assign(new Event("eip6963:announceProvider"), { detail: { info: { uuid: "u2", rdns: "test.empty", name: "Empty Wallet" }, provider: w.info.provider } })));
    writeKey(WALLET_ID_KEY, "test.empty"); // its own id: wallet discovery is remembered for the life of the page
    await expect(reconnectSilently(1500)).resolves.toBe(false);
    expect(w.methods()).not.toContain("eth_requestAccounts");
  });

  it("gives a signer only for the account an action needs, and only on MST testnet", async () => {
    const w = fakeWallet();
    await connectWallet(w.info);
    const ok = await walletSigner(ACCOUNT_A);
    expect(await ok.getAddress()).toBe(ACCOUNT_A);
    const wrong = await walletSigner(ACCOUNT_B).catch((e: unknown) => e);
    expect(wrong).toBeInstanceOf(WalletError);
    expect((wrong as WalletError).code).toBe("wrong-account");
    expect((wrong as WalletError).message).toMatch(/Switch accounts in your wallet/);
    // the wallet is moved to another network by the person
    w.s.chainId = 1;
    const net = await walletSigner(ACCOUNT_A).catch((e: unknown) => e);
    expect((net as WalletError).code).toBe("wrong-network");
    expect((net as WalletError).message).toContain("MST Testnet");
  });

  it("refuses to sign with nothing connected", async () => {
    const e = await walletSigner().catch((x: unknown) => x);
    expect((e as WalletError).code).toBe("no-wallet");
  });

  it("forgets the wallet on disconnect", async () => {
    const w = fakeWallet();
    await connectWallet(w.info);
    expect(readKey(WALLET_ID_KEY)).toBe("test.wallet");
    disconnectWallet();
    expect(readKey(WALLET_ID_KEY)).toBeNull();
    expect(walletState()).toMatchObject({ account: null, status: "idle" });
  });

  it("turns wallet errors into one plain sentence", () => {
    expect(explainWalletError({ code: 4001 })).toMatch(/nothing was sent/i);
    expect(explainWalletError({ code: "ACTION_REJECTED" })).toMatch(/nothing was sent/i);
    expect(explainWalletError({ code: -32002 })).toMatch(/already has a request open/i);
  });
});

describe("the vaults this browser knows (wallet mode has no chain-wide registry)", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    vi.stubGlobal("window", new EventTarget());
    removeKey("mv.vaults.mst.v1");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("remembers a vault once, newest first, and forgets it again", () => {
    rememberVault(ACCOUNT_A, 10);
    rememberVault(ACCOUNT_B);
    rememberVault(ACCOUNT_A.toLowerCase(), 12); // the same address in another case is the same vault
    expect(knownVaults().map((v) => v.address)).toEqual([ACCOUNT_A, ACCOUNT_B]);
    expect(knownVaults()[0].block).toBe(12);
    forgetVault(ACCOUNT_A);
    expect(knownVaults().map((v) => v.address)).toEqual([ACCOUNT_B]);
  });

  it("ignores a damaged list instead of crashing", () => {
    writeKey("mv.vaults.mst.v1", "{not json");
    expect(knownVaults()).toEqual([]);
    writeKey("mv.vaults.mst.v1", JSON.stringify([{ address: "nope" }, { address: ACCOUNT_A, addedAt: 1 }]));
    expect(knownVaults().map((v) => v.address)).toEqual([ACCOUNT_A]);
  });

  it("accepts only a real address when opening a vault by address", () => {
    expect(parseVaultAddress(`  ${ACCOUNT_A.toLowerCase()}  `)).toBe(ACCOUNT_A);
    expect(parseVaultAddress("0x123")).toBeNull();
    expect(parseVaultAddress("")).toBeNull();
  });
});

describe("the choices the first-run screen remembers", () => {
  it("uses three distinct values", () => {
    expect(new Set([DEMO_CHOICE, WALLET_CHOICE, VIEWER_CHOICE]).size).toBe(3);
    expect(KEYS.wallet).toBe("mv.onboard.wallet");
  });
});
