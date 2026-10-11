import { isHosted } from "./hosted";
import { KEYS, readKey } from "./onboarding";

/**
 * Which chain this page talks to. Fixed for the life of the page (changing it reloads the page), so every module can read
 * `NET` once:
 *  - "local":  Hardhat on this machine, signed by its unlocked test accounts. The default on localhost, works offline, never
 *              touches a browser extension.
 *  - "wallet": MST testnet, read from the public RPC and signed by the visitor's own browser wallet (a real pop-up for every
 *              transaction). The only mode on a hosted copy (there is no local chain there), and an option on localhost.
 */
export type Net = "local" | "wallet";

/** What `mv.onboard.wallet` holds: the local test accounts, a real browser wallet, or "just looking" (a wallet-mode visitor with no wallet). */
export const DEMO_CHOICE = "demo";
export const WALLET_CHOICE = "browser";
export const VIEWER_CHOICE = "viewer";

export function detectNet(hosted: boolean, stored: string | null): Net {
  return hosted || stored === WALLET_CHOICE || stored === VIEWER_CHOICE ? "wallet" : "local";
}

export const NET: Net = detectNet(isHosted, readKey(KEYS.wallet));

/** The address used when nobody is connected: a stranger to every vault. */
export const NOBODY = "0x0000000000000000000000000000000000000000";
