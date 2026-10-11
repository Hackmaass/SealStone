import { keccak256, toUtf8Bytes } from "ethers";
import { canonicalJSON } from "./canonical";
import { confirmedChecklistSchema, type ConfirmedChecklist } from "./schema/confirmed";

/**
 * agreementHash = keccak256(utf8(canonicalJSON(confirmed))).
 * The input is re-parsed with the strict schema first, so an invalid checklist can never be hashed and the
 * hash is always taken over the parsed (canonical) value, never over unvalidated raw JSON.
 */
export function agreementHash(confirmed: ConfirmedChecklist): string {
  const parsed = confirmedChecklistSchema.parse(confirmed);
  return keccak256(toUtf8Bytes(canonicalJSON(parsed)));
}

/** keccak256 of a UTF-8 string (used for the agreement source text). */
export function textHash(text: string): string {
  return keccak256(toUtf8Bytes(text));
}

/** SHA-256 of raw bytes via WebCrypto (Node 20+ and browsers). Returns 0x-prefixed lowercase hex. */
export async function fileSha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return "0x" + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
