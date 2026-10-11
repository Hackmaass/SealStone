/**
 * The ONE place that normalizes agreement text before hashing or grounding (CRLF/CR -> LF).
 * Use it for `sourceTextHash` everywhere: server, deploy script, tests, web.
 */
export function normalizeSourceText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Lower-case, unify curly quotes and dashes, collapse whitespace. For "is this quote in the text?" checks. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `quote` occurs in `source` (case-insensitive, whitespace/quote/dash-normalized). */
export function quoteInSource(quote: string, source: string): boolean {
  const q = normalizeForMatch(quote);
  return q.length > 0 && normalizeForMatch(source).includes(q);
}
