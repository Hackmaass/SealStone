import { z } from "zod";
import { deliverableTypeSchema } from "./confirmed";

/**
 * ProposedChecklist: what the AI (or the rules extractor) PROPOSES. It is never hashed, never deployed.
 * Only `assertConfirmable()` (shared/src/gate.ts) turns a human-edited proposal into a ConfirmedChecklist.
 */

export const AMBIGUITY_TYPES = [
  "MISSING_PARTY",
  "PARTY_CONFLICT",
  "MISSING_AMOUNT",
  "AMOUNT_MISMATCH",
  "CONDITIONAL_AMOUNT",
  "AMOUNT_NOT_IN_TEXT",
  "VAGUE_CONDITION",
  "SUBJECTIVE_APPROVAL",
  "MISSING_DEADLINE",
  "UNDEFINED_TRANSITION",
  "CURRENCY_UNCLEAR",
] as const;
export const ambiguityTypeSchema = z.enum(AMBIGUITY_TYPES);
export type AmbiguityType = z.infer<typeof ambiguityTypeSchema>;

export type Severity = "blocking" | "warning";

/** Default severity per type (docs/05). VAGUE_CONDITION is decided per milestone by the validator (V6/V7). */
export const SEVERITY_BY_TYPE: Record<AmbiguityType, Severity> = {
  MISSING_PARTY: "blocking",
  PARTY_CONFLICT: "blocking",
  MISSING_AMOUNT: "blocking",
  AMOUNT_MISMATCH: "blocking",
  CONDITIONAL_AMOUNT: "blocking",
  AMOUNT_NOT_IN_TEXT: "blocking",
  VAGUE_CONDITION: "warning",
  SUBJECTIVE_APPROVAL: "warning",
  MISSING_DEADLINE: "warning",
  UNDEFINED_TRANSITION: "blocking",
  CURRENCY_UNCLEAR: "blocking",
};

export const ambiguitySchema = z.object({
  id: z.string().min(1),
  origin: z.enum(["ai", "validator"]),
  type: ambiguityTypeSchema,
  severity: z.enum(["blocking", "warning"]),
  milestoneIndex: z.number().int().min(0).nullable(),
  quote: z.string().nullable(),
  message: z.string(),
  question: z.string(),
  suggestedResolutions: z.array(z.string()),
});
export type Ambiguity = z.infer<typeof ambiguitySchema>;

const partyRefSchema = z.object({ name: z.string().nullable(), quote: z.string().nullable() });
export const ROLES = ["client", "provider", "arbiter"] as const;
export type Role = (typeof ROLES)[number];

const conditionSchema = z.object({ text: z.string(), objective: z.boolean() });

const proposedMilestoneSchema = z.object({
  index: z.number().int().min(0),
  title: z.string(),
  amount: z.string().nullable(), // decimal ETH as written; null if not stated
  conditions: z.array(conditionSchema),
  deadline: z.string().nullable(), // ISO date if stated
  deliverableType: deliverableTypeSchema,
  quote: z.string().nullable(), // source span
});

export const proposedChecklistSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.enum(["ollama", "gemini", "rules"]),
  title: z.string(),
  parties: z.object({ client: partyRefSchema, provider: partyRefSchema, arbiter: partyRefSchema }),
  currency: z.string().nullable(),
  totalStated: z.string().nullable(),
  milestones: z.array(proposedMilestoneSchema),
  ambiguities: z.array(ambiguitySchema),
  confidence: z.number().transform((n) => Math.min(1, Math.max(0, n > 1 ? n / 100 : n))),
});
export type ProposedChecklist = z.infer<typeof proposedChecklistSchema>;
export type ProposedMilestone = ProposedChecklist["milestones"][number];

// ── What an LLM is asked to produce (no source/origin/id/severity: the rules assign those) ──

const llmAmbiguitySchema = z.object({
  type: ambiguityTypeSchema,
  milestoneIndex: z.number().int().min(0).nullable(),
  quote: z.string().nullable(),
  message: z.string(),
  question: z.string(),
  suggestedResolutions: z.array(z.string()),
});

export const llmChecklistSchema = z.object({
  title: z.string(),
  parties: z.object({ client: partyRefSchema, provider: partyRefSchema, arbiter: partyRefSchema }),
  currency: z.string().nullable(),
  totalStated: z.string().nullable(),
  milestones: z.array(proposedMilestoneSchema),
  ambiguities: z.array(llmAmbiguitySchema),
  confidence: proposedChecklistSchema.shape.confidence,
});
export type LlmChecklist = z.infer<typeof llmChecklistSchema>;

const nullableString = { type: ["string", "null"] };
const partyJson = {
  type: "object",
  properties: { name: nullableString, quote: nullableString },
  required: ["name", "quote"],
};

/** Hand-written JSON Schema of `LlmChecklist` for Ollama's `format` field (a test keeps it in sync with zod). */
export const llmChecklistJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    parties: {
      type: "object",
      properties: { client: partyJson, provider: partyJson, arbiter: partyJson },
      required: ["client", "provider", "arbiter"],
    },
    currency: nullableString,
    totalStated: nullableString,
    milestones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          title: { type: "string" },
          amount: nullableString,
          conditions: {
            type: "array",
            items: {
              type: "object",
              properties: { text: { type: "string" }, objective: { type: "boolean" } },
              required: ["text", "objective"],
            },
          },
          deadline: nullableString,
          deliverableType: { type: "string", enum: ["document", "code", "other"] },
          quote: nullableString,
        },
        required: ["index", "title", "amount", "conditions", "deadline", "deliverableType", "quote"],
      },
    },
    ambiguities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...AMBIGUITY_TYPES] },
          milestoneIndex: { type: ["integer", "null"] },
          quote: nullableString,
          message: { type: "string" },
          question: { type: "string" },
          suggestedResolutions: { type: "array", items: { type: "string" } },
        },
        required: ["type", "milestoneIndex", "quote", "message", "question", "suggestedResolutions"],
      },
    },
    confidence: { type: "number" },
  },
  required: ["title", "parties", "currency", "totalStated", "milestones", "ambiguities", "confidence"],
} as const;

/** Stable ambiguity id (docs/05). `n` is always 0: ambiguities are de-duplicated on (type, milestoneIndex). */
export function ambiguityId(type: AmbiguityType, milestoneIndex: number | null): string {
  return `${type}:${milestoneIndex ?? "agreement"}:0`;
}
