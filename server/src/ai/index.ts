import {
  SEVERITY_BY_TYPE,
  ambiguityId,
  llmChecklistSchema,
  mergeAmbiguities,
  normalizeProposed,
  normalizeSourceText,
  sanitizeQuotes,
  validate,
  type Ambiguity,
  type LlmChecklist,
  type ProposedChecklist,
} from "@mv/shared";
import { callGemini } from "./gemini";
import { chatOllama, hasModel, listOllamaModels, type FetchLike } from "./ollama";
import { MAX_INPUT_CHARS, SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { extractWithRules } from "./rules";

export type Mode = "auto" | "ollama" | "gemini" | "rules";
export type Source = "ollama" | "gemini" | "rules";

export interface AiConfig {
  ollamaUrl: string;
  ollamaModel: string;
  geminiKey: string;
  geminiModel: string;
  /** Optional: Sarvam AI for the assistant, the arbiter brief and the approval review (never for extraction). */
  sarvamKey?: string;
  sarvamModel?: string;
  /** Per-call LLM timeout. Spec: 30 s. */
  llmTimeoutMs: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv): AiConfig {
  return {
    ollamaUrl: (env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
    ollamaModel: env.OLLAMA_MODEL || "llama3.2:3b",
    geminiKey: env.GEMINI_API_KEY || "",
    geminiModel: env.GEMINI_MODEL || "",
    sarvamKey: env.SARVAM_API_KEY || "",
    sarvamModel: env.SARVAM_MODEL || "sarvam-105b-conversations",
    llmTimeoutMs: 30_000,
  };
}

export interface ExtractMeta {
  requestedMode: Mode;
  source: Source;
  model: string | null;
  latencyMs: number;
  fallbackReason: string | null;
  truncated: boolean;
}

export interface ExtractResult {
  /** The sanitized proposal (quotes grounded, objective flags recomputed). NEVER deployable as-is. */
  proposed: ProposedChecklist;
  /** AI flags ∪ validator flags, de-duplicated, validator severity wins. */
  ambiguities: Ambiguity[];
  hardErrors: string[];
  notes: string[];
  meta: ExtractMeta;
}

export interface AiDeps {
  fetchImpl: FetchLike;
  config: AiConfig;
}

export interface ProviderStatus {
  ollama: boolean;
  gemini: boolean;
  sarvam: boolean;
  rules: true;
  models: { ollama: { configured: string; installed: string[] | null }; gemini: { configured: string | null } };
}

export async function providerStatus(deps: AiDeps): Promise<ProviderStatus> {
  const installed = await listOllamaModels(deps.fetchImpl, deps.config.ollamaUrl);
  return {
    ollama: installed !== null && hasModel(installed, deps.config.ollamaModel),
    gemini: Boolean(deps.config.geminiKey && deps.config.geminiModel),
    sarvam: Boolean(deps.config.sarvamKey),
    rules: true,
    models: {
      ollama: { configured: deps.config.ollamaModel, installed },
      gemini: { configured: deps.config.geminiModel || null },
    },
  };
}

function stripFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

/** The model answered, but its output does not fit the schema: worth one retry with the error appended. */
class BadOutputError extends Error {}

/** The model's JSON is parsed with zod. Anything that does not fit throws with a message fit to send back to the model. */
function parseLlm(raw: string): LlmChecklist {
  let json: unknown;
  try {
    json = JSON.parse(stripFences(raw));
  } catch (e) {
    throw new BadOutputError(`not valid JSON (${(e as Error).message})`);
  }
  const parsed = llmChecklistSchema.safeParse(json);
  if (!parsed.success) {
    throw new BadOutputError(parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

/** Rules decide: source/origin/id/severity are assigned here, never taken from the model. */
function toProposed(llm: LlmChecklist, source: "ollama" | "gemini"): ProposedChecklist {
  return {
    schemaVersion: 1,
    source,
    title: llm.title,
    parties: llm.parties,
    currency: llm.currency,
    totalStated: llm.totalStated,
    milestones: llm.milestones,
    confidence: llm.confidence,
    ambiguities: llm.ambiguities.map((a) => ({
      id: ambiguityId(a.type, a.milestoneIndex),
      origin: "ai" as const,
      type: a.type,
      severity: SEVERITY_BY_TYPE[a.type],
      milestoneIndex: a.milestoneIndex,
      quote: a.quote,
      message: a.message,
      question: a.question,
      suggestedResolutions: a.suggestedResolutions,
    })),
  };
}

type Chosen =
  | { source: "ollama"; model: string; reason: null }
  | { source: "gemini"; model: string; reason: null }
  | { source: "rules"; model: null; reason: string | null };

async function chooseProvider(mode: Mode, deps: AiDeps): Promise<Chosen> {
  const { config } = deps;
  const rules = (reason: string | null): Chosen => ({ source: "rules", model: null, reason });
  if (mode === "rules") return rules(null);

  const wantOllama = mode === "auto" || mode === "ollama";
  const wantGemini = mode === "auto" || mode === "gemini";
  const reasons: string[] = [];

  if (wantOllama) {
    const installed = await listOllamaModels(deps.fetchImpl, config.ollamaUrl);
    if (installed === null) reasons.push(`Ollama is not reachable at ${config.ollamaUrl}`);
    else if (!hasModel(installed, config.ollamaModel)) {
      reasons.push(`Ollama model "${config.ollamaModel}" is not installed (installed: ${installed.join(", ") || "none"})`);
    } else return { source: "ollama", model: config.ollamaModel, reason: null };
  }
  if (wantGemini) {
    if (!config.geminiKey || !config.geminiModel) reasons.push("Gemini is not configured (GEMINI_API_KEY and GEMINI_MODEL)");
    else return { source: "gemini", model: config.geminiModel, reason: null };
  }
  return rules(reasons.join("; "));
}

async function callProvider(chosen: Extract<Chosen, { source: "ollama" | "gemini" }>, user: string, deps: AiDeps): Promise<string> {
  const { config, fetchImpl } = deps;
  if (chosen.source === "ollama") {
    return chatOllama({ fetchImpl, baseUrl: config.ollamaUrl, model: chosen.model, system: SYSTEM_PROMPT, user, timeoutMs: config.llmTimeoutMs });
  }
  return callGemini({ fetchImpl, apiKey: config.geminiKey, model: chosen.model, system: SYSTEM_PROMPT, user, timeoutMs: config.llmTimeoutMs });
}

/**
 * AI proposes; rules decide. Whatever the source, the result is normalised, grounded, validated and merged
 * by the shared deterministic validator. On any LLM failure (unreachable, timeout, bad JSON twice) it falls back to rules.
 */
export async function extract(rawText: string, mode: Mode, deps: AiDeps): Promise<ExtractResult> {
  const started = Date.now();
  const normalized = normalizeSourceText(rawText);
  const truncated = normalized.length > MAX_INPUT_CHARS;
  const text = truncated ? normalized.slice(0, MAX_INPUT_CHARS) : normalized;
  const notes: string[] = [];
  if (truncated) notes.push(`The agreement is longer than ${MAX_INPUT_CHARS} characters; only the first ${MAX_INPUT_CHARS} were analysed.`);

  const chosen = await chooseProvider(mode, deps);
  let source: Source = "rules";
  let model: string | null = null;
  let fallbackReason = chosen.reason;
  let proposed: ProposedChecklist | null = null;

  if (chosen.source !== "rules") {
    let lastError = "";
    for (let attempt = 0; attempt < 2 && proposed === null; attempt++) {
      try {
        const raw = await callProvider(chosen, buildUserPrompt(text, attempt === 0 ? undefined : lastError), deps);
        proposed = toProposed(parseLlm(raw), chosen.source);
        source = chosen.source;
        model = chosen.model;
      } catch (e) {
        lastError = (e as Error).message;
        // Network/HTTP failures will not be fixed by re-asking; only bad output earns the one retry.
        if (!(e instanceof BadOutputError)) break;
      }
    }
    if (proposed === null) fallbackReason = `${chosen.source} failed: ${lastError}. Fell back to rules.`;
  }
  if (proposed === null) proposed = extractWithRules(text);

  const sanitized = sanitizeQuotes(normalizeProposed(proposed), text);
  notes.push(...sanitized.notes);
  const checked = validate(sanitized.proposed, text, "proposal");
  const ambiguities = mergeAmbiguities(sanitized.proposed.ambiguities, checked.ambiguities);

  return {
    proposed: sanitized.proposed,
    ambiguities,
    hardErrors: checked.hardErrors,
    notes,
    meta: { requestedMode: mode, source, model, latencyMs: Date.now() - started, fallbackReason, truncated },
  };
}
