/**
 * Where to draw the amber marks in the agreement text.
 * Validator quotes are short snippets ("remaining", "extra if"), and AMOUNT_MISMATCH's quote is the bare "5", so a
 * naive search would mark the first "5" anywhere. Quotes are searched inside the milestone's own paragraph, quotes
 * shorter than 4 characters are skipped, and flags without a usable quote anchor to the milestone heading or the Total line.
 */

export type Range = [start: number, end: number];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive, whitespace-flexible, curly-quote and dash tolerant search. */
export function findQuote(source: string, quote: string, from = 0, to = source.length): Range | null {
  const q = quote.trim();
  if (q === "") return null;
  const pattern = q
    .split(/\s+/)
    .map((word) =>
      [...word]
        .map((ch) => (/['‘’]/.test(ch) ? "['‘’]" : /["“”]/.test(ch) ? '["“”]' : /[-–—]/.test(ch) ? "[-–—]" : escapeRe(ch)))
        .join(""),
    )
    .join("\\s+");
  const m = new RegExp(pattern, "i").exec(source.slice(from, to));
  return m ? [from + m.index, from + m.index + m[0].length] : null;
}

export interface AnchorInput {
  id: string;
  quote: string | null;
  milestoneIndex: number | null;
}

/** First sentence-ish chunk of a milestone paragraph: its heading. */
function headingRange(span: Range, source: string): Range {
  const text = source.slice(span[0], span[1]);
  const cut = /[.\n]/.exec(text);
  return [span[0], span[0] + Math.min(cut ? cut.index : text.length, 70)];
}

export function locateAnchors(source: string, items: AnchorInput[], milestoneQuotes: Array<string | null>): Map<string, Range> {
  const out = new Map<string, Range>();
  for (const it of items) {
    const msQuote = it.milestoneIndex !== null ? milestoneQuotes[it.milestoneIndex] ?? null : null;
    const scope = msQuote ? findQuote(source, msQuote) : null;
    let found: Range | null = null;
    if (it.quote && it.quote.trim().length >= 4) {
      found = (scope && findQuote(source, it.quote, scope[0], scope[1])) || findQuote(source, it.quote);
    }
    if (!found) {
      if (it.milestoneIndex !== null && scope) found = headingRange(scope, source);
      else {
        const total = /^[ \t]*total[^\n]*/im.exec(source);
        if (total) found = [total.index, total.index + total[0].length];
      }
    }
    if (found) out.set(it.id, found);
  }
  return out;
}

export interface Segment {
  text: string;
  id?: string;
}

/** Cuts the source into plain and marked segments. Overlapping spans are dropped (first start wins). */
export function buildSegments(source: string, anchors: Map<string, Range>): Segment[] {
  const sorted = [...anchors.entries()].sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]);
  const segs: Segment[] = [];
  let pos = 0;
  for (const [id, [start, end]] of sorted) {
    if (start < pos || end <= start) continue;
    if (start > pos) segs.push({ text: source.slice(pos, start) });
    segs.push({ text: source.slice(start, end), id });
    pos = end;
  }
  if (pos < source.length) segs.push({ text: source.slice(pos) });
  return segs;
}
