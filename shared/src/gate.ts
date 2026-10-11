import { getAddress } from "ethers";
import { z } from "zod";
import { confirmedChecklistSchema, resolutionSchema, type ConfirmedChecklist, type Resolution } from "./schema/confirmed";
import { ROLES, type Ambiguity, type ProposedChecklist, type Role } from "./schema/proposed";
import { normalizeSourceText } from "./text";
import { textHash } from "./hash";
import { mergeAmbiguities } from "./validate/merge";
import { normalizeProposed, parseAmountWei, validate } from "./validate/validator";

/**
 * THE CONFIRMATION GATE. `assertConfirmable()` is the ONLY function that produces a ConfirmedChecklist.
 * No function that deploys or sends a transaction may accept a ProposedChecklist (docs/05).
 *
 * The gate does not trust the caller to say what needs resolving. It recomputes the required set itself from the
 * ORIGINAL proposal and the source text (validator in "proposal" mode, unioned with whatever AI flags the proposal
 * carries), then enforces the four rules of the resolution gate:
 *   1. every ambiguity has a resolution
 *   2. every blocking ambiguity is resolved by "edited" or "clause-removed" (acknowledging is not enough)
 *   3. the validator, re-run on the EDITED checklist, produces zero blocking issues
 *   4. wallet addresses are assigned to all three roles and are distinct
 */

export class GateError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Cannot confirm: ${errors.join("; ")}`);
    this.name = "GateError";
    this.errors = errors;
  }
}

export interface GateInput {
  /** The checklist exactly as extracted (needed to recompute which ambiguities must be resolved). */
  proposed: ProposedChecklist;
  /** The same checklist after the human edited it (amounts, conditions, deadlines, names). */
  edited: ProposedChecklist;
  sourceText: string;
  resolutions: Resolution[];
  addresses: Record<Role, string>;
  reviewWindowSeconds: number;
  extraction: { source: "ollama" | "gemini" | "rules"; model: string | null };
  /** ISO datetime; injected so the result is reproducible. */
  confirmedAt: string;
}

export interface GateReport {
  /** Everything that must be resolved: validator (proposal mode) ∪ AI flags ∪ new flags created by editing. */
  required: Ambiguity[];
  errors: string[];
}

/** Dry run: lists every unmet condition without throwing. The web uses it to keep the Confirm button honest. */
export function checkGate(input: GateInput): GateReport {
  const errors: string[] = [];
  const source = normalizeSourceText(input.sourceText);
  const proposed = normalizeProposed(input.proposed);
  const edited = normalizeProposed(input.edited);

  const proposalCheck = validate(proposed, source, "proposal");
  const editedCheck = validate(edited, source, "edited");
  const required = mergeAmbiguities(proposed.ambiguities, [...proposalCheck.ambiguities]);
  // An edit can create new flags; those must be resolved too (rule 3 below additionally forbids new blocking ones).
  const requiredIds = new Set(required.map((a) => a.id));
  for (const a of editedCheck.ambiguities) {
    if (requiredIds.has(a.id)) continue;
    // A conditional amount already explains a missing figure: do not add a duplicate MISSING_AMOUNT for the same milestone.
    if (a.type === "MISSING_AMOUNT" && requiredIds.has(`CONDITIONAL_AMOUNT:${a.milestoneIndex}:0`)) continue;
    required.push(a);
  }

  for (const e of [...proposalCheck.hardErrors, ...editedCheck.hardErrors]) {
    if (!errors.includes(e)) errors.push(e);
  }

  // Rules 1 and 2
  const byId = new Map<string, Resolution>();
  for (const r of input.resolutions) {
    const parsed = resolutionSchema.safeParse(r);
    if (!parsed.success) {
      errors.push(`Invalid resolution for "${r.ambiguityId}": ${parsed.error.issues.map((i) => i.message).join(", ")}`);
      continue;
    }
    if (byId.has(r.ambiguityId)) errors.push(`Duplicate resolution for "${r.ambiguityId}".`);
    byId.set(r.ambiguityId, parsed.data);
  }
  const knownIds = new Set(required.map((a) => a.id));
  for (const id of byId.keys()) {
    if (!knownIds.has(id)) errors.push(`Resolution for unknown ambiguity "${id}".`);
  }
  for (const a of required) {
    const r = byId.get(a.id);
    if (!r) {
      errors.push(`Unresolved ${a.severity} ambiguity ${a.id}: ${a.message}`);
    } else if (a.severity === "blocking" && r.action === "acknowledged") {
      errors.push(`${a.id} is blocking: it must be resolved by editing the checklist or removing the clause, not acknowledged.`);
    }
  }

  // Rule 3: re-run on the edited checklist
  for (const a of editedCheck.ambiguities) {
    if (a.severity === "blocking") errors.push(`Still blocking after editing: ${a.id}: ${a.message}`);
  }

  // Rule 4: addresses
  const normalized: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    try {
      normalized[role] = getAddress(input.addresses[role]);
    } catch {
      errors.push(`No valid wallet address assigned to the ${role}.`);
    }
  }
  const unique = new Set(Object.values(normalized));
  if (unique.size !== Object.keys(normalized).length) errors.push("Client, provider and arbiter must have three different wallet addresses.");

  // Misc. facts the confirmed checklist needs
  if (!Number.isInteger(input.reviewWindowSeconds) || input.reviewWindowSeconds <= 0) errors.push("The review window must be a positive whole number of seconds.");
  for (const role of ROLES) {
    if (!edited.parties[role].name?.trim()) errors.push(`The ${role} needs a name.`);
  }
  edited.milestones.forEach((m, i) => {
    if (parseAmountWei(m.amount) === null) errors.push(`Milestone ${i + 1} needs a positive amount in ETH.`);
    if (m.conditions.length === 0) errors.push(`Milestone ${i + 1} needs at least one condition.`);
  });

  return { required, errors: [...new Set(errors)] };
}

/** Throws a GateError listing EVERY unmet condition, or returns the only thing that may reach the chain. */
export function assertConfirmable(input: GateInput): ConfirmedChecklist {
  const { errors } = checkGate(input);
  if (errors.length > 0) throw new GateError(errors);

  const edited = normalizeProposed(input.edited);
  const candidate = {
    schemaVersion: 1,
    title: edited.title.trim(),
    parties: Object.fromEntries(
      ROLES.map((r) => [r, { name: edited.parties[r].name!.trim(), address: getAddress(input.addresses[r]) }]),
    ),
    milestones: edited.milestones.map((m, i) => ({
      index: i,
      title: m.title.trim(),
      amountWei: parseAmountWei(m.amount)!.toString(),
      conditions: m.conditions.map((c) => c.text.trim()),
      deadline: m.deadline,
      deliverableType: m.deliverableType,
    })),
    reviewWindowSeconds: input.reviewWindowSeconds,
    resolutions: input.resolutions.map((r) => resolutionSchema.parse(r)),
    extraction: { source: input.extraction.source, model: input.extraction.model, sourceTextHash: textHash(normalizeSourceText(input.sourceText)) },
    confirmedAt: input.confirmedAt,
  };
  try {
    return confirmedChecklistSchema.parse(candidate);
  } catch (e) {
    if (e instanceof z.ZodError) throw new GateError(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
    throw e;
  }
}
