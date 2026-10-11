export { canonicalJSON } from "./canonical";
export { agreementHash, textHash, fileSha256 } from "./hash";
export {
  confirmedChecklistSchema,
  resolutionSchema,
  deliverableTypeSchema,
  type ConfirmedChecklist,
  type Resolution,
  type DeliverableType,
} from "./schema/confirmed";
export { normalizeSourceText, normalizeForMatch, quoteInSource } from "./text";
export {
  AMBIGUITY_TYPES,
  ROLES,
  SEVERITY_BY_TYPE,
  ambiguitySchema,
  ambiguityTypeSchema,
  ambiguityId,
  llmChecklistJsonSchema,
  llmChecklistSchema,
  proposedChecklistSchema,
  type Ambiguity,
  type AmbiguityType,
  type LlmChecklist,
  type ProposedChecklist,
  type ProposedMilestone,
  type Role,
  type Severity,
} from "./schema/proposed";
export {
  AUTO_TRANSITION_PATTERNS,
  CONDITIONAL_AMOUNT_PATTERNS,
  CURRENCY_PATTERNS,
  SUBJECTIVE_PATTERNS,
  VAGUE_WORDS,
  firstMatch,
  isObjectiveCondition,
  isSubjective,
  isVague,
} from "./validate/lexicon";
export { ethAmountsInText, normalizeProposed, parseAmountWei, sanitizeQuotes, validate, type ValidationMode, type ValidationResult } from "./validate/validator";
export { mergeAmbiguities } from "./validate/merge";
export { GateError, assertConfirmable, checkGate, type GateInput, type GateReport } from "./gate";
export { extractWithRules } from "./extract/rules";
export {
  ASSISTANT_PAGES,
  HELP_TEXT,
  assistantActionSchema,
  assistantContextSchema,
  assistantMessageSchema,
  ruleReply,
  sanitizeActions,
  type AssistantAction,
  type AssistantContext,
  type AssistantReply,
} from "./assistant";
