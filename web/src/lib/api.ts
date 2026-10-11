import { z } from "zod";
import { isHosted } from "./hosted";
import { ambiguitySchema, assistantActionSchema, proposedChecklistSchema, confirmedChecklistSchema, type AssistantContext, type ConfirmedChecklist, type GateInput, type Resolution } from "@mv/shared";

// A hosted copy is deployed with the server as a second Vercel service on the same domain, so it calls /api on its own origin.
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? (isHosted ? "" : "http://127.0.0.1:8787");

/** A hosted copy with no AI service of its own must not call loopback (browsers may show a "local network access" prompt for that). */
const NO_SERVICE_HERE: boolean = isHosted && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(API_URL);

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
  providers: z.object({ ollama: z.boolean(), gemini: z.boolean(), sarvam: z.boolean().optional(), rules: z.boolean() }),
  models: z.object({
    ollama: z.object({ configured: z.string(), installed: z.array(z.string()).nullable() }),
    gemini: z.object({ configured: z.string().nullable() }),
  }),
});
export type Health = z.infer<typeof healthSchema>;

/** Advice from the assistant, the arbiter brief and the approval review. It never extracts a checklist (that stays on `Mode`). */
export type AdviceMode = "auto" | "sarvam" | "ollama" | "rules";
const adviceMeta = z.object({ source: z.enum(["sarvam", "ollama", "rules"]), model: z.string().nullable(), latencyMs: z.number(), fallbackReason: z.string().nullable() });
export type AdviceMeta = z.infer<typeof adviceMeta>;
const assistantReplySchema = z.object({ reply: z.string(), actions: z.array(assistantActionSchema), meta: adviceMeta });
export type AssistantAnswer = z.infer<typeof assistantReplySchema>;
const evidenceSchema = z.object({
  kind: z.enum(["brief", "review"]),
  items: z.array(
    z.object({
      condition: z.string(),
      status: z.string(),
      clientPoints: z.array(z.string()),
      providerPoints: z.array(z.string()),
      quotes: z.array(z.object({ from: z.enum(["client", "provider", "deliverable"]), text: z.string() })),
      downgraded: z.boolean(),
    }),
  ),
  meta: adviceMeta,
});
export type EvidenceResponse = z.infer<typeof evidenceSchema>;
export interface EvidenceRequest {
  kind: "brief" | "review";
  mode: AdviceMode;
  conditions: string[];
  texts: { client?: string; provider?: string; deliverable?: string };
}

const sampleSchema = z.array(z.object({ name: z.string(), text: z.string() }));

const confirmSchema = z.object({ confirmed: confirmedChecklistSchema, agreementHash: z.string(), canonical: z.string() });

export class ApiOffline extends Error {
  constructor() {
    super(NO_SERVICE_HERE ? "This hosted copy has no AI service, so the built-in rules are used." : "The AI service isn't running. Start it with npm run server. You can still use the built-in rules.");
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
  if (NO_SERVICE_HERE) throw new ApiOffline();
  let res: Response | undefined;
  // A read (GET) is safe to repeat: one refused request (some machines do that at random) must not look like "the service is down".
  const attempts = (init?.method ?? "GET") === "GET" ? 3 : 1;
  for (let i = 1; i <= attempts && !res; i++) {
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      res = await fetch(`${API_URL}${path}`, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      if (i === attempts) throw new ApiOffline();
      await new Promise((r) => setTimeout(r, 250 * i));
    }
  }
  if (!res) throw new ApiOffline();
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
  assistant: (messages: Array<{ role: "user" | "assistant"; text: string }>, context: AssistantContext, mode: AdviceMode) => call("/api/assistant", assistantReplySchema, post({ messages, context, mode }), 45_000),
  evidence: (req: EvidenceRequest) => call("/api/evidence", evidenceSchema, post(req), 60_000),
  samples: () => call("/api/samples", sampleSchema),
  /** Extraction can take ~60 s with a cold local model plus one retry, so the client waits 75 s. */
  extract: (text: string, mode: Mode, signal?: AbortSignal) => call("/api/extract", extractSchema, post({ text, mode }, signal), 75_000),
  confirm: (input: Omit<GateInput, "confirmedAt">) => call("/api/confirm", confirmSchema, post(input), 20_000),
  /** The stored confirmed JSON for a hash. Returned unparsed on purpose: the caller re-hashes it and never trusts the server's copy. */
  agreement: (hash: string) => call(`/api/agreements/${hash}`, z.unknown(), undefined, 6_000),
  saveNote: (hash: string, text: string) => call("/api/notes", z.object({ hash: z.string() }), post({ hash, text }), 6_000),
  note: (hash: string) => call(`/api/notes/${hash}`, z.object({ hash: z.string(), text: z.string() }), undefined, 6_000),
};

export type { ConfirmedChecklist, Resolution };
