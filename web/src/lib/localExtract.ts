import { extractWithRules, mergeAmbiguities, normalizeProposed, normalizeSourceText, sanitizeQuotes, validate } from "@mv/shared";
import type { ExtractResponse } from "./api";

const MAX_INPUT_CHARS = 6000;

/**
 * The same pipeline as the server's rules path, running in the browser: rules extractor, quote grounding,
 * the deterministic validator, merge. Works with the AI service stopped and with Wi-Fi off.
 */
export function extractLocally(rawText: string, fallbackReason: string | null = null, requestedMode: ExtractResponse["meta"]["requestedMode"] = "rules"): ExtractResponse {
  const started = performance.now();
  const normalized = normalizeSourceText(rawText);
  const truncated = normalized.length > MAX_INPUT_CHARS;
  const text = truncated ? normalized.slice(0, MAX_INPUT_CHARS) : normalized;
  const sanitized = sanitizeQuotes(normalizeProposed(extractWithRules(text)), text);
  const checked = validate(sanitized.proposed, text, "proposal");
  return {
    proposed: sanitized.proposed,
    ambiguities: mergeAmbiguities(sanitized.proposed.ambiguities, checked.ambiguities),
    hardErrors: checked.hardErrors,
    notes: truncated ? [`The agreement is longer than ${MAX_INPUT_CHARS} characters; only the first ${MAX_INPUT_CHARS} were analysed.`, ...sanitized.notes] : sanitized.notes,
    meta: { requestedMode, source: "rules", model: null, latencyMs: Math.round(performance.now() - started), fallbackReason, truncated },
  };
}
