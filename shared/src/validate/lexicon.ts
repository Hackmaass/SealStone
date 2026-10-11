/**
 * The word lists the deterministic validator scans for. Short and readable on purpose: judges may read them.
 * A match raises a question for the human; it never decides anything about money by itself.
 */

/** Vague, unmeasurable wording (VAGUE_CONDITION). */
export const VAGUE_WORDS: RegExp[] = [
  /\bsatisfactory\b/i,
  /\b(good|high|decent|acceptable|reasonable|professional) (quality|standard)\b/i,
  /\bquality work\b/i,
  /\breasonabl[ey]\b/i,
  /\bas (needed|required|necessary|appropriate)\b/i,
  /\bas soon as possible\b|\basap\b/i,
  /\b(appropriate|adequate|proper|suitable)(ly)?\b/i,
  /\btimely\b|\bpromptly\b/i,
  /\bbest efforts?\b/i,
  /\band so on\b|\betc\b/i,
];

/** Approval that depends on one person's opinion (SUBJECTIVE_APPROVAL). */
export const SUBJECTIVE_PATTERNS: RegExp[] = [
  /\bto the [^.,;]{1,40}?satisfaction\b/i,
  /\bsatisf(y|ies|ied|action)\b/i,
  /\b(sole|absolute) discretion\b/i,
  /\bdeems? fit\b/i,
  /\bto (his|her|their|its) (liking|approval)\b/i,
];

/** Amounts that are not a fixed figure (CONDITIONAL_AMOUNT). */
export const CONDITIONAL_AMOUNT_PATTERNS: RegExp[] = [
  /\bremaining\b/i,
  /\bbalance\b/i,
  /\bbonus\b/i,
  // A percentage only counts when it is attached to money ("10% of the fee", "50% upfront", "payment: 25%"),
  // never "80% confidence" or "95% test coverage".
  /\d\s*%\s*(of\b|upfront|up-front|in advance|advance|bonus|extra|deposit|retainer|fee|payment|withheld|now|later|on (delivery|completion|approval|signing))/i,
  /\b(payment|pay|paid|fee|amount|price|worth|bonus)\b[^.\n]{0,25}\d\s*%/i,
  /\bper ?cent(age)?\s+of\b/i,
  /\bextra\b[^.]{0,80}\bif\b|\bif\b[^.]{0,80}\bextra\b/i,
  /\bwhatever (is )?left\b|\bresidual\b|\bpro[- ]?rata\b/i,
  /\bdeduct(ion|ed|s)?\b|\bpenalt(y|ies)\b/i,
];

/** Money moving without a defined contract transition (UNDEFINED_TRANSITION). */
export const AUTO_TRANSITION_PATTERNS: RegExp[] = [
  /\bautomatically\b/i,
  /\bauto[- ]?(release|approv\w*|pay\w*)\b/i,
  /\bdeemed\s+(to\s+be\s+)?(approved|accepted|complete\w*)\b/i,
  /\bif (there is )?no (response|reply|objection|answer)\b/i,
  /\bin the absence of (a )?(response|reply|objection)\b/i,
  /\bsilence\b[^.]{0,30}\b(accept\w*|consent|approv\w*)\b/i,
];

/** A currency other than ETH, or an unspecified "equivalent" (CURRENCY_UNCLEAR). */
export const CURRENCY_PATTERNS: RegExp[] = [
  /₹|€|£|\$/,
  /\bRs\.?(?=\s|\d)/,
  /\b(INR|USD|EUR|GBP)\b/,
  /\b(rupees?|dollars?|euros?)\b/i,
  /\bor equivalent\b/i,
];

/** First regex in `patterns` that matches `text`, as the matched snippet (or null). */
export function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m[0];
  }
  return null;
}

export function isVague(text: string): boolean {
  return firstMatch(text, VAGUE_WORDS) !== null;
}

export function isSubjective(text: string): boolean {
  return firstMatch(text, SUBJECTIVE_PATTERNS) !== null;
}

/** A condition is objective unless it uses vague or subjective wording. Rules decide this, never the model. */
export function isObjectiveCondition(text: string): boolean {
  return text.trim().length > 0 && !isVague(text) && !isSubjective(text);
}
