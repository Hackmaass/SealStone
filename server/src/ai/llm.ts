import { callSarvam } from "./sarvam";
import { chatOllama, hasModel, listOllamaModels } from "./ollama";
import type { AiDeps } from "./index";

/**
 * One place that answers "ask a model, if any is available": Sarvam (optional, needs a key), then the local Ollama model, and
 * otherwise nothing, so the caller uses its own deterministic rules. The assistant, the arbiter brief and the approval review
 * all use this; extraction keeps its own provider logic. Every caller treats the answer as advice and checks it.
 */
export type ChatMode = "auto" | "sarvam" | "ollama" | "rules";
export type ChatSource = "sarvam" | "ollama" | "rules";

export interface ChatResult {
  /** null means no model answered: use the rules. */
  text: string | null;
  source: ChatSource;
  model: string | null;
  fallbackReason: string | null;
  latencyMs: number;
}

/** How long Sarvam gets before the rules answer instead. Short on purpose: on a network that swallows packets (Wi-Fi off, captive portal) the first click must not hang. */
export const SARVAM_TIMEOUT_MS = 8_000;

export async function chatAdvisory(opts: { deps: AiDeps; mode: ChatMode; system: string; user: string; sarvamTimeoutMs?: number }): Promise<ChatResult> {
  const started = Date.now();
  const { fetchImpl, config } = opts.deps;
  const done = (text: string | null, source: ChatSource, model: string | null, reasons: string[]): ChatResult => ({
    text,
    source,
    model,
    fallbackReason: text === null && reasons.length ? `${reasons.join("; ")}. Used the built-in rules.` : null,
    latencyMs: Date.now() - started,
  });
  if (opts.mode === "rules") return done(null, "rules", null, []);

  const reasons: string[] = [];
  if (opts.mode === "auto" || opts.mode === "sarvam") {
    if (!config.sarvamKey) reasons.push("Sarvam is not configured (SARVAM_API_KEY)");
    else {
      try {
        const text = await callSarvam({ fetchImpl, apiKey: config.sarvamKey, model: config.sarvamModel || "sarvam-105b-conversations", system: opts.system, user: opts.user, timeoutMs: opts.sarvamTimeoutMs ?? SARVAM_TIMEOUT_MS });
        return done(text, "sarvam", config.sarvamModel || "sarvam-105b-conversations", []);
      } catch (e) {
        reasons.push(`Sarvam failed: ${(e as Error).message}`);
      }
    }
  }
  if (opts.mode === "auto" || opts.mode === "ollama") {
    const installed = await listOllamaModels(fetchImpl, config.ollamaUrl);
    if (installed === null) reasons.push(`Ollama is not reachable at ${config.ollamaUrl}`);
    else if (!hasModel(installed, config.ollamaModel)) reasons.push(`Ollama model "${config.ollamaModel}" is not installed`);
    else {
      try {
        const text = await chatOllama({ fetchImpl, baseUrl: config.ollamaUrl, model: config.ollamaModel, system: opts.system, user: opts.user, timeoutMs: config.llmTimeoutMs, format: "json" });
        return done(text, "ollama", config.ollamaModel, []);
      } catch (e) {
        reasons.push(`Ollama failed: ${(e as Error).message}`);
      }
    }
  }
  return done(null, "rules", null, reasons);
}

export const stripFences = (raw: string): string => raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

/** First JSON object in a model's answer (models sometimes wrap it in prose). null if there is none. */
export function parseJsonLoose(raw: string): unknown {
  const cleaned = stripFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const a = cleaned.indexOf("{");
    const b = cleaned.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(cleaned.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
