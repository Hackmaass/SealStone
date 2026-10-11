import { z } from "zod";
import { ambiguitySchema, proposedChecklistSchema, confirmedChecklistSchema, type ConfirmedChecklist, type GateInput, type Resolution } from "@mv/shared";

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://127.0.0.1:8787";

export type Mode = "auto" | "ollama" | "gemini" | "rules";

const metaSchema = z.object({
  requestedMode: z.enum(["auto", "ollama", "gemini", "rules"]),
  source: z.enum(["ollama", "gemini", "rules"]),
  model: z.string().nullable(),
  latencyMs: z.number(),
  fallbackReason: z.string().nullable(),
  truncated: z.boolean(),
});

const extractSchema = z.object({
  proposed: proposedChecklistSchema,
  ambiguities: z.array(ambiguitySchema),
  hardErrors: z.array(z.string()),
  notes: z.array(z.string()),
  meta: metaSchema,
});
export type ExtractResponse = z.infer<typeof extractSchema>;

const healthSchema = z.object({
  ok: z.boolean(),
  providers: z.object({ ollama: z.boolean(), gemini: z.boolean(), rules: z.boolean() }),
  models: z.object({
    ollama: z.object({ configured: z.string(), installed: z.array(z.string()).nullable() }),
    gemini: z.object({ configured: z.string().nullable() }),
  }),
});
export type Health = z.infer<typeof healthSchema>;

const sampleSchema = z.array(z.object({ name: z.string(), text: z.string() }));

const confirmSchema = z.object({ confirmed: confirmedChecklistSchema, agreementHash: z.string(), canonical: z.string() });

export class ApiOffline extends Error {
  constructor() {
    super("The AI service isn't running. Start it with npm run server. You can still use the built-in rules.");
    this.name = "ApiOffline";
  }
}

export class ApiRejected extends Error {
  readonly errors: string[];
  constructor(message: string, errors: string[]) {
    super(message);
    this.name = "ApiRejected";
    this.errors = errors;
  }
}

async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
  let res: Response;
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    res = await fetch(`${API_URL}${path}`, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiOffline();
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { error?: string; errors?: string[]; issues?: string[] };
    throw new ApiRejected(b.error ?? `HTTP ${res.status}`, b.errors ?? b.issues ?? []);
  }
  return schema.parse(body);
}

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  signal,
});

export const api = {
  health: () => call("/api/health", healthSchema, undefined, 4_000),
  samples: () => call("/api/samples", sampleSchema),
  /** Extraction can take ~60 s with a cold local model plus one retry, so the client waits 75 s. */
  extract: (text: string, mode: Mode, signal?: AbortSignal) => call("/api/extract", extractSchema, post({ text, mode }, signal), 75_000),
  confirm: (input: Omit<GateInput, "confirmedAt">) => call("/api/confirm", confirmSchema, post(input), 20_000),
};

export type { ConfirmedChecklist, Resolution };
