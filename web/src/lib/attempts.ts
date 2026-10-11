import type { Attempt } from "./vaultModel";

/**
 * Refused attempts never reach the chain (the node rejects them before mining), so the timeline can only show them
 * from here. They are kept per vault in sessionStorage so a reload doesn't erase the evidence.
 */
// `epoch` identifies THIS life of the demo chain (deployment.json's generatedAt changes on every reset). A reset redeploys
// the vault at the same address, so without it a rehearsal's refusals would reappear in the next fresh demo.
const key = (address: string, epoch: string) => `mv.attempts.${address.toLowerCase()}.${epoch}`;
const MAX = 40;

export function loadAttempts(address: string, epoch: string): Attempt[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(key(address, epoch)) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as Attempt[]).slice(-MAX) : [];
  } catch {
    return [];
  }
}

export function saveAttempts(address: string, epoch: string, attempts: Attempt[]): void {
  try {
    sessionStorage.setItem(key(address, epoch), JSON.stringify(attempts.slice(-MAX)));
  } catch {
    /* storage blocked: attempts then live only in memory */
  }
}
