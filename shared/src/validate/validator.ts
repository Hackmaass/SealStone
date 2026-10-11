import { parseEther } from "ethers";
import {
  ROLES,
  SEVERITY_BY_TYPE,
  ambiguityId,
  type Ambiguity,
  type AmbiguityType,
  type ProposedChecklist,
  type Severity,
} from "../schema/proposed";
import { normalizeForMatch, quoteInSource } from "../text";
import {
  AUTO_TRANSITION_PATTERNS,
  CONDITIONAL_AMOUNT_PATTERNS,
  CURRENCY_PATTERNS,
  SUBJECTIVE_PATTERNS,
  VAGUE_WORDS,
  firstMatch,
  isObjectiveCondition,
} from "./lexicon";

/**
 * Deterministic validator (docs/05 V1–V11). Runs identically on the server and in the web, whatever the source.
 *
 * Two modes:
 *  - "proposal": the checklist as extracted. Full rules, including grounding against the source text (V10) and
 *    scans of the source quotes.
 *  - "edited": the checklist after a human edited it (gate rule 3). Structure, arithmetic, parties and the lexicon
 *    over the edited titles/conditions only. Grounding and source scans are skipped: a figure a human typed
 *    (e.g. 1.5 ETH replacing "remaining funds") never appears in the source, and the source still says "automatically"
 *    after the clause was removed, so neither could ever clear. Grounding is enforced through gate rule 2 instead:
 *    AMOUNT_NOT_IN_TEXT is blocking, so a human must edit it or remove the clause.
 */
export type ValidationMode = "proposal" | "edited";

export interface ValidationResult {
  /** All with origin "validator", de-duplicated on (type, milestoneIndex), ids stable. */
  ambiguities: Ambiguity[];
  /** Structural problems that can never be confirmed (e.g. 0 or 21 milestones). */
  hardErrors: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── Amount helpers (exact: bigint wei via parseEther, never floats) ──

/** "2.5", "2.50 ETH", "1,000 eth" -> wei. Null if absent, unparsable or not positive. */
export function parseAmountWei(amount: string | null | undefined): bigint | null {
  if (amount == null) return null;
  const cleaned = amount.trim().replace(/\s*(test[- ])?eth$/i, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,18})?$/.test(cleaned)) return null;
  const wei = parseEther(cleaned);
  return wei > 0n ? wei : null;
}

/** Every "<number> ETH" figure in the text, as wei. Plain numbers ("20 farmers") never count. */
export function ethAmountsInText(text: string): Set<bigint> {
  const out = new Set<bigint>();
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:test[- ])?eth\b/gi)) {
    const wei = parseAmountWei(m[1]);
    if (wei !== null) out.add(wei);
  }
  return out;
}

// ── Normalisation: the rules decide, not the model ──

/** Forces index = position and recomputes every condition's `objective` flag from the lexicon. */
export function normalizeProposed(p: ProposedChecklist): ProposedChecklist {
  return {
    ...p,
    milestones: p.milestones.map((m, i) => ({
      ...m,
      index: i,
      conditions: m.conditions.map((c) => ({ text: c.text, objective: isObjectiveCondition(c.text) })),
    })),
  };
}

/** V10 (quotes): any quote that is not a substring of the source becomes null. Returns notes for each one. */
export function sanitizeQuotes(p: ProposedChecklist, sourceText: string): { proposed: ProposedChecklist; notes: string[] } {
  const notes: string[] = [];
  const clean = (q: string | null, where: string): string | null => {
    if (q === null || q === "") return null;
    if (quoteInSource(q, sourceText)) return q;
    notes.push(`Quote removed (not found in the agreement text): ${where}`);
    return null;
  };
  const parties = Object.fromEntries(
    ROLES.map((r) => [r, { name: p.parties[r].name, quote: clean(p.parties[r].quote, `${r} party`) }]),
  ) as ProposedChecklist["parties"];
  return {
    notes,
    proposed: {
      ...p,
      parties,
      milestones: p.milestones.map((m, i) => ({ ...m, quote: clean(m.quote, `milestone ${i + 1}`) })),
      ambiguities: p.ambiguities.map((a) => ({ ...a, quote: clean(a.quote, `ambiguity ${a.id}`) })),
    },
  };
}

// ── The validator ──

class Collector {
  private readonly map = new Map<string, Ambiguity>();

  has(type: AmbiguityType, milestoneIndex: number | null): boolean {
    return this.map.has(ambiguityId(type, milestoneIndex));
  }

  add(
    type: AmbiguityType,
    milestoneIndex: number | null,
    spec: { quote?: string | null; message: string; question: string; suggestedResolutions: string[]; severity?: Severity },
  ): void {
    const id = ambiguityId(type, milestoneIndex);
    if (this.map.has(id)) return;
    this.map.set(id, {
      id,
      origin: "validator",
      type,
      severity: spec.severity ?? SEVERITY_BY_TYPE[type],
      milestoneIndex,
      quote: spec.quote ?? null,
      message: spec.message,
      question: spec.question,
      suggestedResolutions: spec.suggestedResolutions,
    });
  }

  list(): Ambiguity[] {
    return [...this.map.values()];
  }
}

export function validate(proposed: ProposedChecklist, sourceText: string, mode: ValidationMode = "proposal"): ValidationResult {
  const p = normalizeProposed(proposed);
  const out = new Collector();
  const hardErrors: string[] = [];
  const proposal = mode === "proposal";
  const label = (i: number) => `Milestone ${i + 1}`;

  // V1 all three parties present; V2 distinct
  const names = ROLES.map((r) => [r, p.parties[r].name?.trim() ?? ""] as const);
  const missing = names.filter(([, n]) => n === "").map(([r]) => r);
  if (missing.length > 0) {
    out.add("MISSING_PARTY", null, {
      message: `No ${missing.join(", ")} named in the agreement.`,
      question: `Who is the ${missing.join(" and the ")}? All three parties must be named.`,
      suggestedResolutions: missing.map((r) => `Name the ${r}`),
    });
  }
  const present = names.filter(([, n]) => n !== "");
  const seen = new Map<string, string>();
  for (const [role, name] of present) {
    const key = normalizeForMatch(name);
    const other = seen.get(key);
    if (other) {
      out.add("PARTY_CONFLICT", null, {
        quote: name,
        message: `The same party ("${name}") is named as both ${other} and ${role}.`,
        question: "Client, provider and arbiter must be three different parties. Who is each one?",
        suggestedResolutions: [`Name a different ${role}`, "Name an independent arbiter"],
      });
    } else {
      seen.set(key, role);
    }
  }

  // V3 milestone count
  if (p.milestones.length < 1 || p.milestones.length > 20) {
    hardErrors.push(`An agreement needs 1 to 20 milestones (found ${p.milestones.length}).`);
  }

  // Source-level figures for grounding
  const sourceEth = proposal ? ethAmountsInText(sourceText) : new Set<bigint>();

  // Per milestone: V4, V6–V11
  let sum = 0n;
  p.milestones.forEach((m, i) => {
    const scan = [m.title, ...m.conditions.map((c) => c.text), ...(proposal && m.quote ? [m.quote] : [])];
    const scanJoined = scan.join("\n");

    // V8 conditional amount (checked first: it explains a missing figure)
    const cond = firstMatch(scanJoined, CONDITIONAL_AMOUNT_PATTERNS);
    if (cond !== null) {
      out.add("CONDITIONAL_AMOUNT", i, {
        quote: cond,
        message: `${label(i)}'s payment depends on something other than a fixed figure ("${cond}").`,
        question: `What exact amount (in ETH) is ${label(i)} worth, and is any bonus or remainder part of it?`,
        suggestedResolutions: ["Replace with an explicit fixed amount", "Remove the conditional clause"],
      });
    }

    // V4 amount present, positive, parseable
    const wei = parseAmountWei(m.amount);
    if (wei === null) {
      if (!out.has("CONDITIONAL_AMOUNT", i)) {
        out.add("MISSING_AMOUNT", i, {
          message: m.amount ? `${label(i)}'s amount "${m.amount}" is not a valid positive ETH figure.` : `${label(i)} has no stated amount.`,
          question: `How much ETH is ${label(i)} worth?`,
          suggestedResolutions: ["Enter an explicit amount in ETH"],
        });
      }
    } else {
      sum += wei;
      // V10 grounding: the figure must appear, as "<n> ETH", in the source text
      if (proposal && !sourceEth.has(wei)) {
        out.add("AMOUNT_NOT_IN_TEXT", i, {
          quote: m.amount,
          message: `${label(i)}'s amount (${m.amount} ETH) does not appear in the agreement text.`,
          question: "The amount was not found in the text, so it may have been invented. What does the agreement actually say?",
          suggestedResolutions: ["Correct the amount to match the text", "Remove the milestone or clause"],
        });
      }
    }

    // V6 at least one objective condition; V7 vague / subjective wording
    const objectiveCount = m.conditions.filter((c) => c.objective).length;
    const vague = firstMatch(scanJoined, VAGUE_WORDS);
    if (m.conditions.length === 0 || objectiveCount === 0) {
      out.add("VAGUE_CONDITION", i, {
        severity: "blocking",
        quote: vague,
        message:
          m.conditions.length === 0
            ? `${label(i)} has no approval condition at all.`
            : `${label(i)} has no objective, checkable condition${vague ? ` ("${vague}")` : ""}.`,
        question: `What concrete, checkable condition decides that ${label(i)} is done?`,
        suggestedResolutions: ["Add a measurable condition (a count, a file, a test)", "Remove the vague clause"],
      });
    } else if (vague !== null) {
      out.add("VAGUE_CONDITION", i, {
        severity: "warning",
        quote: vague,
        message: `${label(i)} uses vague wording ("${vague}").`,
        question: "Is this wording measurable? How will the client and provider both know it is met?",
        suggestedResolutions: ["Replace with a measurable condition", "Acknowledge: both parties accept the wording"],
      });
    }
    const subjective = firstMatch(scanJoined, SUBJECTIVE_PATTERNS);
    if (subjective !== null) {
      out.add("SUBJECTIVE_APPROVAL", i, {
        quote: subjective,
        message: `${label(i)} depends on one person's opinion ("${subjective}").`,
        question: "Is there an objective check instead of personal satisfaction? If not, who decides, and how?",
        suggestedResolutions: ["Replace with an objective acceptance test", "Acknowledge: the arbiter settles any disagreement"],
      });
    }

    // V9 auto-transitions
    const auto = firstMatch(scanJoined, AUTO_TRANSITION_PATTERNS);
    if (auto !== null) {
      out.add("UNDEFINED_TRANSITION", i, {
        quote: auto,
        message: `${label(i)} describes money moving without a defined step ("${auto}"). The contract only allows approve, dispute and arbiter rulings.`,
        question: "Who must act for the money to move? The contract cannot release funds by itself.",
        suggestedResolutions: ["Remove the automatic clause", "Replace with the client's review window followed by escalation to the arbiter"],
      });
    }

    // V11 deadline
    if (m.deadline === null || !ISO_DATE.test(m.deadline)) {
      out.add("MISSING_DEADLINE", i, {
        message: m.deadline ? `${label(i)}'s deadline "${m.deadline}" is not a clear date.` : `${label(i)} has no deadline.`,
        question: `By when must ${label(i)} be delivered?`,
        suggestedResolutions: ["Add a date (YYYY-MM-DD)", "Acknowledge: no deadline by agreement"],
      });
    }
  });

  // V9 (agreement level): an automatic clause in the source that no milestone captured
  if (proposal && firstMatch(sourceText, AUTO_TRANSITION_PATTERNS) !== null) {
    const anyMilestone = p.milestones.some((_, i) => out.has("UNDEFINED_TRANSITION", i));
    if (!anyMilestone) {
      const snippet = firstMatch(sourceText, AUTO_TRANSITION_PATTERNS);
      out.add("UNDEFINED_TRANSITION", null, {
        quote: snippet,
        message: `The agreement describes money moving without a defined step ("${snippet}").`,
        question: "Who must act for the money to move? The contract cannot release funds by itself.",
        suggestedResolutions: ["Remove the automatic clause", "Replace with the client's review window followed by escalation to the arbiter"],
      });
    }
  }

  // V5 totals: sum of the stated amounts vs the stated total (exact, in wei)
  if (p.totalStated !== null && p.totalStated.trim() !== "") {
    const total = parseAmountWei(p.totalStated);
    if (total === null || sum !== total) {
      out.add("AMOUNT_MISMATCH", null, {
        quote: p.totalStated,
        message:
          total === null
            ? `The stated total "${p.totalStated}" is not a valid ETH figure.`
            : `The milestones add up to ${formatWei(sum)} ETH but the agreement states a total of ${formatWei(total)} ETH.`,
        question: "Which is right: the total or the milestone amounts?",
        suggestedResolutions: ["Correct the total to match the milestones", "Correct the milestone amounts to match the total"],
      });
    }
  }

  // CURRENCY_UNCLEAR (documented extra rule; V1–V11 never emit it): anything but ETH
  const currencyOk = p.currency === null || p.currency.trim().toUpperCase() === "ETH";
  const foreign = proposal ? firstMatch(sourceText, CURRENCY_PATTERNS) : null;
  if (!currencyOk || foreign !== null) {
    out.add("CURRENCY_UNCLEAR", null, {
      quote: foreign,
      message: !currencyOk ? `The currency is stated as "${p.currency}", not ETH.` : `The agreement mentions another currency or an "equivalent" ("${foreign}").`,
      question: "All amounts must be fixed in test ETH. What exact ETH amounts apply?",
      suggestedResolutions: ["State every amount in ETH", "Remove the other-currency wording"],
    });
  }

  return { ambiguities: out.list(), hardErrors };
}

function formatWei(wei: bigint): string {
  const s = wei.toString().padStart(19, "0");
  const whole = s.slice(0, -18).replace(/^0+(?=\d)/, "");
  const frac = s.slice(-18).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
