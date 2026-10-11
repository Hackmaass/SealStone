import type { FetchLike } from "./ollama";

/** Gemini via plain REST (no SDK). Fails closed: callers must check that the key AND model are set. */
export async function callGemini(opts: {
  fetchImpl: FetchLike;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  timeoutMs?: number;
}): Promise<string> {
  if (!opts.apiKey || !opts.model) throw new Error("Gemini is not configured (GEMINI_API_KEY and GEMINI_MODEL are required)");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`;
  const res = await opts.fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: [{ text: opts.user }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (text === "") throw new Error("Gemini returned no content");
  return text;
}
