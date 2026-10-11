import { z } from "zod";
import { quoteInSource } from "@mv/shared";
import { chatAdvisory, parseJsonLoose, type ChatMode, type ChatSource } from "./llm";
import type { AiDeps } from "./index";

/**
 * Two advisory tools share one engine: "does this text address each agreed condition?"
 *  - brief  (for the arbiter on a disputed milestone): the client's evidence and the provider's evidence, per condition.
 *  - review (for the client at approval time): the delivered work's text, per condition.
 * It is ADVICE ONLY. The output has no ruling and no approve/refuse field, a statement counts only if a verbatim quote backs it
 * (checked here, not trusted from the model), and nothing here can reach the contract.
 */
export type EvidenceKind = "brief" | "review";
const STATUSES = { brief: ["supported", "contested", "not-addressed"], review: ["appears-met", "unclear", "not-found"] } as const;
const SAFE_STATUS = { brief: "not-addressed", review: "unclear" } as const;
const LAST_RESORT = { brief: "not-addressed", review: "not-found" } as const;

export const evidenceBodySchema = z.object({
  kind: z.enum(["brief", "review"]),
  mode: z.enum(["auto", "sarvam", "ollama", "rules"]).default("auto"),
  conditions: z.array(z.string().min(1).max(600)).min(1).max(20),
  texts: z.object({
    client: z.string().max(20_000).optional(),
    provider: z.string().max(20_000).optional(),
    deliverable: z.string().max(40_000).optional(),
  }),
});
export type EvidenceBody = z.infer<typeof evidenceBodySchema>;
type Origin = "client" | "provider" | "deliverable";

export interface EvidenceItem {
  condition: string;
  status: string;
  clientPoints: string[];
  providerPoints: string[];
  quotes: Array<{ from: Origin; text: string }>;
  /** true when a claim was downgraded because no verbatim quote backed it */
  downgraded: boolean;
}
export interface EvidenceResult {
  kind: EvidenceKind;
  items: EvidenceItem[];
  meta: { source: ChatSource; model: string | null; latencyMs: number; fallbackReason: string | null };
}

const llmSchema = z.object({
  items: z
    .array(
      z.object({
        index: z.number().int().min(0),
        status: z.string(),
        clientPoints: z.array(z.string().max(400)).max(4).default([]),
        providerPoints: z.array(z.string().max(400)).max(4).default([]),
        quotes: z.array(z.object({ from: z.enum(["client", "provider", "deliverable"]), text: z.string().max(400) })).max(4).default([]),
      }),
    )
    .max(20),
});

function systemPrompt(kind: EvidenceKind): string {
  const common = `You compare agreed milestone CONDITIONS with TEXT supplied by people. You are an advisor, not a judge: never say who is right, never recommend a ruling, never mention money amounts to release or refund.
Reply with ONLY a JSON object: {"items":[{"index":number,"status":string,"clientPoints":string[],"providerPoints":string[],"quotes":[{"from":"client"|"provider"|"deliverable","text":string}]}]} with one item per condition, "index" being the condition's number.
Every quote MUST be copied word for word from the given text and should be the shortest phrase (ideally under 25 words) that shows the point; if you cannot quote it, do not claim it. At most 2 short points per side.`;
  return kind === "brief"
    ? `${common}\nstatus is one of: "supported" (only one side addresses this condition with a quote), "contested" (both sides address it, differently), "not-addressed" (no quote from either side).`
    : `${common}\nOnly "deliverable" text is given. Put what it shows in clientPoints. status is one of: "appears-met" (a quote shows the condition's content), "unclear" (related but not conclusive), "not-found" (nothing relevant).`;
}

function userPrompt(b: EvidenceBody): string {
  const conds = b.conditions.map((c, i) => `${i}. ${c}`).join("\n");
  const t = b.texts;
  const blocks = [t.client && `CLIENT TEXT:\n${t.client}`, t.provider && `PROVIDER TEXT:\n${t.provider}`, t.deliverable && `DELIVERABLE TEXT:\n${t.deliverable}`].filter(Boolean).join("\n\n");
  return `CONDITIONS:\n${conds}\n\n${blocks || "(no text was supplied)"}`;
}

/** Rules decide: statuses the model invented are replaced, quotes not found verbatim are dropped, and an unquoted claim is downgraded. */
function groundItem(kind: EvidenceKind, condition: string, raw: z.infer<typeof llmSchema>["items"][number] | undefined, texts: EvidenceBody["texts"]): EvidenceItem {
  if (!raw) return { condition, status: LAST_RESORT[kind], clientPoints: [], providerPoints: [], quotes: [], downgraded: false };
  const quotes = raw.quotes.filter((q) => quoteInSource(q.text, texts[q.from] ?? ""));
  const valid = (STATUSES[kind] as readonly string[]).includes(raw.status) ? raw.status : SAFE_STATUS[kind];
  const claims = valid === "supported" || valid === "contested" || valid === "appears-met";
  const downgraded = claims && quotes.length === 0;
  // "contested" needs a quote from BOTH sides; with only one side quoted it is "supported".
  let status = downgraded ? SAFE_STATUS[kind] : valid;
  if (status === "contested" && !(quotes.some((q) => q.from === "client") && quotes.some((q) => q.from === "provider"))) status = "supported";
  return { condition, status, clientPoints: raw.clientPoints, providerPoints: raw.providerPoints, quotes, downgraded };
}

// ───────────────────────── rules fallback (no model) ─────────────────────────
const STOP = new Set("that this with from have will were been their there which shall must into than then when also each such only upon about after before under over your they them what does done made make more most some any all and the for are was has had not but can may per via least minimum".split(" "));
/** Crude stemming, enough for "interviews / interviewed / interview", "pages / page", "disease / diseases", "ranks / ranked". */
const stem = (w: string): string => {
  let x = w.toLowerCase();
  if (x.length > 5) x = x.replace(/(ing|ed|ly)$/, "");
  return x.replace(/(es|s)$/, "").replace(/e$/, "");
};
interface Wanted {
  words: string[];
  numbers: string[];
  /** "at least N": satisfied by any number M >= N in the sentence */
  atLeast: number[];
}
const THRESHOLD = /(?:at least|minimum of|no fewer than)\s+(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:or more|\+)/gi;
const numOf = (s: string): number => Number(s.replace(",", "."));

function wanted(condition: string): Wanted {
  const atLeast = [...condition.matchAll(THRESHOLD)].map((m) => numOf(m[1] ?? m[2]));
  const rest = condition.replace(THRESHOLD, " ");
  const words = [...new Set((rest.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((t) => !STOP.has(t)).map(stem))];
  const numbers = [...new Set(rest.match(/\d+(?:[.,]\d+)?%?/g) ?? [])];
  return { words, numbers, atLeast };
}

function scoreSentence(w: Wanted, sentence: string): number {
  const have = new Set((sentence.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((t) => !STOP.has(t)).map(stem));
  const nums = (sentence.match(/\d+(?:[.,]\d+)?%?/g) ?? []).map((n) => n);
  const total = w.words.length + w.numbers.length + w.atLeast.length;
  if (total === 0) return 0;
  const hitWords = w.words.filter((t) => have.has(t)).length;
  const hitNums = w.numbers.filter((n) => nums.includes(n)).length;
  const hitLeast = w.atLeast.filter((n) => nums.some((m) => !m.endsWith("%") && numOf(m) >= n)).length;
  return (hitWords + hitNums + hitLeast) / total;
}

const sentences = (s: string): string[] => s.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 8);

function bestSentence(condition: string, text: string | undefined): { score: number; sentence: string } | null {
  if (!text) return null;
  const w = wanted(condition);
  let best: { score: number; sentence: string } | null = null;
  for (const sentence of sentences(text)) {
    const score = scoreSentence(w, sentence);
    if (!best || score > best.score) best = { score, sentence };
  }
  return best;
}

function rulesEvidence(b: EvidenceBody): EvidenceItem[] {
  return b.conditions.map((condition) => {
    if (b.kind === "review") {
      const hit = bestSentence(condition, b.texts.deliverable);
      const status = !hit ? "not-found" : hit.score >= 0.6 ? "appears-met" : hit.score >= 0.3 ? "unclear" : "not-found";
      const quotes = hit && status !== "not-found" ? [{ from: "deliverable" as const, text: hit.sentence.slice(0, 300) }] : [];
      return { condition, status, clientPoints: [], providerPoints: [], quotes, downgraded: false };
    }
    const c = bestSentence(condition, b.texts.client);
    const p = bestSentence(condition, b.texts.provider);
    const cHit = c && c.score >= 0.4 ? c : null;
    const pHit = p && p.score >= 0.4 ? p : null;
    const quotes = [cHit && { from: "client" as const, text: cHit.sentence.slice(0, 300) }, pHit && { from: "provider" as const, text: pHit.sentence.slice(0, 300) }].filter((x): x is { from: "client" | "provider"; text: string } => Boolean(x));
    return { condition, status: cHit && pHit ? "contested" : cHit || pHit ? "supported" : "not-addressed", clientPoints: cHit ? [cHit.sentence.slice(0, 200)] : [], providerPoints: pHit ? [pHit.sentence.slice(0, 200)] : [], quotes, downgraded: false };
  });
}

export async function analyseEvidence(body: EvidenceBody, deps: AiDeps): Promise<EvidenceResult> {
  const r = await chatAdvisory({ deps, mode: body.mode as ChatMode, system: systemPrompt(body.kind), user: userPrompt(body), sarvamTimeoutMs: 12_000 });
  if (r.text !== null) {
    const parsed = llmSchema.safeParse(parseJsonLoose(r.text));
    if (parsed.success) {
      const items = body.conditions.map((c, i) => groundItem(body.kind, c, parsed.data.items.find((x) => x.index === i), body.texts));
      return { kind: body.kind, items, meta: { source: r.source, model: r.model, latencyMs: r.latencyMs, fallbackReason: null } };
    }
  }
  return {
    kind: body.kind,
    items: rulesEvidence(body),
    meta: { source: "rules", model: null, latencyMs: r.latencyMs, fallbackReason: r.fallbackReason ?? (r.text !== null ? "The model's answer did not fit the expected format" : null) },
  };
}
