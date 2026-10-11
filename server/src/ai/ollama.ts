import { llmChecklistJsonSchema } from "@mv/shared";

export type FetchLike = typeof fetch;

/** Installed model names from GET /api/tags, or null if Ollama does not answer within the timeout. */
export async function listOllamaModels(fetchImpl: FetchLike, baseUrl: string, timeoutMs = 1500): Promise<string[] | null> {
  try {
    const res = await fetchImpl(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: Array<{ name?: string }> };
    return (body.models ?? []).map((m) => m.name ?? "").filter(Boolean);
  } catch {
    return null;
  }
}

/** "llama3.2" matches an installed "llama3.2:3b"; an explicit tag must match exactly. */
export function hasModel(installed: string[], wanted: string): boolean {
  return installed.some((n) => n === wanted || (!wanted.includes(":") && n.startsWith(`${wanted}:`)));
}

export async function chatOllama(opts: {
  fetchImpl: FetchLike;
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  timeoutMs?: number;
}): Promise<string> {
  const res = await opts.fetchImpl(`${opts.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      format: llmChecklistJsonSchema,
      options: { temperature: 0 },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const body = (await res.json()) as { message?: { content?: string } };
  const content = body.message?.content;
  if (typeof content !== "string" || content === "") throw new Error("Ollama returned no content");
  return content;
}
