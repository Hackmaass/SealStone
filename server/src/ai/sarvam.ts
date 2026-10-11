import type { FetchLike } from "./ollama";

/**
 * Sarvam AI chat over plain REST (no SDK, like gemini.ts). The key lives only in the server's environment and never
 * reaches the browser. Fails closed: callers must check that the key is set. Sarvam is an OPTIONAL extra; the demo never needs it.
 * Endpoint and header verified against the official SDK (v1/chat/completions, `api-subscription-key`).
 */
export const SARVAM_BASE = "https://api.sarvam.ai";

export async function callSarvam(opts: {
  fetchImpl: FetchLike;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<string> {
  if (!opts.apiKey) throw new Error("Sarvam is not configured (SARVAM_API_KEY)");
  const res = await opts.fetchImpl(`${SARVAM_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", "api-subscription-key": opts.apiKey },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    body: JSON.stringify({
      model: opts.model,
      temperature: 0.2,
      // Reasoning tokens count toward this limit, so keep it generous.
      max_tokens: opts.maxTokens ?? 2048,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Sarvam HTTP ${res.status}`);
  const body = (await res.json()) as { choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }> };
  const choice = body.choices?.[0];
  const text = choice?.message?.content ?? "";
  if (text.trim() === "") throw new Error(choice?.finish_reason === "length" ? "Sarvam ran out of tokens before answering" : "Sarvam returned no content");
  return text;
}
