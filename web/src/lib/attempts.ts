import type { Attempt } from "./vaultModel";

/**
 * Refused attempts never reach the chain (the node rejects them before mining), so the timeline can only show them
 * from here. They are kept per vault in sessionStorage so a reload doesn't erase the evidence.
 */
const key = (address: string) => `mv.attempts.${address.toLowerCase()}`;
const MAX = 40;

export function loadAttempts(address: string): Attempt[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(key(address)) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as Attempt[]).slice(-MAX) : [];
  } catch {
    return [];
  }
}

export function saveAttempts(address: string, attempts: Attempt[]): void {
  try {
    sessionStorage.setItem(key(address), JSON.stringify(attempts.slice(-MAX)));
  } catch {
    /* storage blocked: attempts then live only in memory */
  }
}
