import { agreementHash, confirmedChecklistSchema, canonicalJSON, type ConfirmedChecklist } from "@mv/shared";
import { api } from "./api";
import { recallAgreement } from "./wizard";

export type TermsSource = "server" | "browser" | "file" | "text";

/**
 * The outcome of checking a confirmed-terms JSON against the hash the contract stores.
 *  - verified: the JSON re-hashes (in THIS browser) to the on-chain hash
 *  - mismatch: it is valid terms, but not the terms that were signed (one changed character is enough)
 *  - invalid:  it is not a valid confirmed checklist at all
 *  - unavailable: nothing to check against yet (server offline and never confirmed in this browser)
 */
export type TermsCheck =
  | { kind: "verified"; checklist: ConfirmedChecklist; source: TermsSource; canonical: string }
  | { kind: "mismatch"; checklist: ConfirmedChecklist; source: TermsSource; computed: string; canonical: string }
  | { kind: "invalid"; source: TermsSource; errors: string[] }
  | { kind: "unavailable" };

/** Recompute canonical JSON + keccak256 here, with the one shared implementation, and compare to the chain. */
export function checkTerms(raw: unknown, onChainHash: string, source: TermsSource): TermsCheck {
  const parsed = confirmedChecklistSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "invalid", source, errors: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  const checklist = parsed.data;
  const computed = agreementHash(checklist);
  const canonical = canonicalJSON(checklist);
  return computed.toLowerCase() === onChainHash.toLowerCase() ? { kind: "verified", checklist, source, canonical } : { kind: "mismatch", checklist, source, computed, canonical };
}

/** Where to look, in order: the AI service's store, then this browser's own copy, then nothing. */
export async function loadTerms(onChainHash: string): Promise<TermsCheck> {
  try {
    return checkTerms(await api.agreement(onChainHash), onChainHash, "server");
  } catch {
    /* 404 or offline: try the browser's copy */
  }
  const local = recallAgreement(onChainHash);
  return local ? checkTerms(local, onChainHash, "browser") : { kind: "unavailable" };
}

export async function checkDroppedFile(file: File, onChainHash: string): Promise<TermsCheck> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return { kind: "invalid", source: "file", errors: ["That file is not valid JSON."] };
  }
  return checkTerms(raw, onChainHash, "file");
}
