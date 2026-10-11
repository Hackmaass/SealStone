import { getAddress, isAddress } from "ethers";
import { readKey, writeKey } from "./onboarding";

/**
 * The vaults this browser knows about, in wallet mode. A public testnet has no registry and scanning it block by block would
 * hammer the RPC, so the list is: vaults created here, plus any the person opens by address. (Local mode instead scans the
 * private chain, which is cheap: see vaultList.ts.) Stored in localStorage, with the in-memory fallback from lib/onboarding.
 */
const KEY = "mv.vaults.mst.v1";
const EVENT = "mv:vaults";

export interface KnownVault {
  address: string;
  /** the block it was created in, when this browser deployed it */
  block?: number;
  addedAt: number;
}

export function knownVaults(): KnownVault[] {
  try {
    const raw = JSON.parse(readKey(KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((v): v is KnownVault => !!v && typeof v === "object" && typeof (v as KnownVault).address === "string" && isAddress((v as KnownVault).address))
      .map((v) => ({ address: getAddress(v.address), block: typeof v.block === "number" ? v.block : undefined, addedAt: Number(v.addedAt) || 0 }))
      .sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

const save = (list: KnownVault[]): void => {
  writeKey(KEY, JSON.stringify(list));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
};

export function rememberVault(address: string, block?: number): void {
  const a = getAddress(address);
  const rest = knownVaults().filter((v) => v.address !== a);
  save([{ address: a, block, addedAt: Date.now() }, ...rest]);
}

export function forgetVault(address: string): void {
  const a = getAddress(address);
  save(knownVaults().filter((v) => v.address !== a));
}

/** Calls `f` whenever the list changes (in this tab). Returns the unsubscribe. */
export function onVaultsChanged(f: () => void): () => void {
  window.addEventListener(EVENT, f);
  return () => window.removeEventListener(EVENT, f);
}

/** What a person may paste to open a vault: an address, with or without whitespace. */
export function parseVaultAddress(input: string): string | null {
  const s = input.trim();
  return isAddress(s) ? getAddress(s) : null;
}
