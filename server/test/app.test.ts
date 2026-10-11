import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { agreementHash, canonicalJSON, normalizeSourceText, type LlmChecklist } from "@mv/shared";
import { createApp } from "../src/app";
import type { AiConfig } from "../src/ai";
import { extractWithRules } from "../src/ai/rules";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SOURCE = normalizeSourceText(read("../../samples/agreements/krishilens.txt"));
const SAMPLE = JSON.parse(read("../../samples/krishilens.confirmed.json"));

const CONFIG: AiConfig = { ollamaUrl: "http://ollama.test", ollamaModel: "llama3.2:3b", geminiKey: "", geminiModel: "", llmTimeoutMs: 2000 };

// ── Fake Ollama, injected into the app (the test's own requests use the real fetch) ──
type Handler = (url: string, body: any) => Response | Promise<Response>;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

function fakeFetch(handler: Handler) {
  const calls: Array<{ url: string; body: any }> = [];
  const impl = (async (input: any, init?: any) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    return handler(url, body);
  }) as typeof fetch;
  return { impl, calls };
}

const unreachable = () => fakeFetch(() => Promise.reject(new TypeError("fetch failed: ECONNREFUSED")));

function ollamaUp(chatContent: (n: number) => string, installed = ["llama3.2:3b"]) {
  let n = 0;
  return fakeFetch((url) => {
    if (url.endsWith("/api/tags")) return json({ models: installed.map((name) => ({ name })) });
    if (url.endsWith("/api/chat")) return json({ message: { content: chatContent(n++) } });
    return json({}, 404);
  });
}

/** What a model might return for KrishiLens: right structure, one AI flag, and one hallucinated amount. */
function llmAnswer(over: (c: LlmChecklist) => void = () => {}): string {
  const rules = extractWithRules(SOURCE);
  const llm: LlmChecklist = {
    title: rules.title,
    parties: rules.parties,
    currency: "ETH",
    totalStated: "5",
    milestones: rules.milestones.map((m) => ({ ...m })),
    ambiguities: [
      {
        type: "SUBJECTIVE_APPROVAL",
        milestoneIndex: 1,
        quote: "to the mentor's satisfaction",
        message: "Approval depends on the mentor's opinion.",
        question: "What objective test replaces it?",
        suggestedResolutions: ["Add a test"],
      },
    ],
    confidence: 0.8,
  };
  over(llm);
  return JSON.stringify(llm);
}

async function serve(opts: Parameters<typeof createApp>[0]) {
  const app = createApp({ config: CONFIG, ...opts });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (p: string, body: unknown) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { base, post, get: (p: string) => fetch(base + p), close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("GET /api/health and provider selection", () => {
  it("reports rules always on and Ollama off when it is unreachable", async () => {
    const s = await serve({ fetchImpl: unreachable().impl });
    const h = await (await s.get("/api/health")).json();
    expect(h).toMatchObject({ ok: true, providers: { ollama: false, gemini: false, rules: true } });
    await s.close();
  });

  it("reports Ollama on only when the CONFIGURED model is installed, and lists what is installed", async () => {
    const withModel = await serve({ fetchImpl: ollamaUp(() => "{}").impl });
    expect((await (await withModel.get("/api/health")).json()).providers.ollama).toBe(true);
    await withModel.close();
    const without = await serve({ fetchImpl: ollamaUp(() => "{}", ["qwen2.5:7b-instruct"]).impl });
    const h = await (await without.get("/api/health")).json();
    expect(h.providers.ollama).toBe(false);
    expect(h.models.ollama.installed).toEqual(["qwen2.5:7b-instruct"]);
    await without.close();
  });
});

describe("POST /api/extract", () => {
  it("falls back to rules with a fallbackReason when Ollama is unreachable (the Wi-Fi-off demo path)", async () => {
    const s = await serve({ fetchImpl: unreachable().impl });
    const r = await (await s.post("/api/extract", { text: SOURCE, mode: "auto" })).json();
    expect(r.meta.source).toBe("rules");
    expect(r.meta.fallbackReason).toMatch(/Ollama is not reachable/);
    expect(r.proposed.milestones).toHaveLength(3);
    expect(r.ambiguities.map((a: any) => a.id)).toContain("CONDITIONAL_AMOUNT:2:0");
    await s.close();
  });

  it("an explicitly requested Ollama that is down still returns a result (rules) with the reason", async () => {
    const s = await serve({ fetchImpl: unreachable().impl });
    const r = await (await s.post("/api/extract", { text: SOURCE, mode: "ollama" })).json();
    expect(r.meta).toMatchObject({ requestedMode: "ollama", source: "rules" });
    expect(r.meta.fallbackReason).toBeTruthy();
    await s.close();
  });

  it("uses Ollama when it answers, and STILL merges the validator's flags with the AI's", async () => {
    const { impl, calls } = ollamaUp(() => llmAnswer());
    const s = await serve({ fetchImpl: impl });
    const r = await (await s.post("/api/extract", { text: SOURCE, mode: "auto" })).json();
    expect(r.meta).toMatchObject({ source: "ollama", model: "llama3.2:3b", fallbackReason: null });
    expect(r.proposed.source).toBe("ollama");
    const ids = r.ambiguities.map((a: any) => a.id);
    expect(ids).toContain("SUBJECTIVE_APPROVAL:1:0"); // from the AI
    expect(ids).toContain("CONDITIONAL_AMOUNT:2:0"); // added by the validator
    const chat = calls.find((c) => c.url.endsWith("/api/chat"))!;
    expect(chat.body).toMatchObject({ model: "llama3.2:3b", stream: false, options: { temperature: 0 } });
    expect(chat.body.format.required).toContain("milestones");
    await s.close();
  });

  it("a hallucinated amount is caught by grounding (AMOUNT_NOT_IN_TEXT, blocking), whatever the model claims", async () => {
    const s = await serve({ fetchImpl: ollamaUp(() => llmAnswer((c) => { c.milestones[0].amount = "100"; })).impl });
    const r = await (await s.post("/api/extract", { text: SOURCE, mode: "auto" })).json();
    const a = r.ambiguities.find((x: any) => x.id === "AMOUNT_NOT_IN_TEXT:0:0");
    expect(a).toMatchObject({ severity: "blocking", origin: "validator" });
    await s.close();
  });

  it("the model cannot set severity, source or ids, and its 'objective' claims are recomputed", async () => {
    const answer = JSON.parse(llmAnswer());
    answer.ambiguities[0].severity = "warning";
    answer.ambiguities[0].id = "FAKE:99:9";
    answer.milestones[1].conditions[1].objective = true; // the subjective condition, claimed objective
    const s = await serve({ fetchImpl: ollamaUp(() => JSON.stringify(answer)).impl });
    const r = await (await s.post("/api/extract", { text: SOURCE, mode: "auto" })).json();
    expect(r.ambiguities.map((a: any) => a.id)).not.toContain("FAKE:99:9");
    expect(r.proposed.milestones[1].conditions[1].objective).toBe(false);
    await s.close();
  });

  it("removes a quote the model invented and says so in notes", async () => {
    const s = await serve({ fetchImpl: ollamaUp(() => llmAnswer((c) => { c.parties.client.quote = "Client: Totally Invented Org"; })).impl });
    const r = await (await s.post("/api/extract", { text: SOURCE, mode: "auto" })).json();
    expect(r.proposed.parties.client.quote).toBeNull();
    expect(r.notes.join(" ")).toMatch(/client party/);
    await s.close();
  });

  it("retries once with the zod error appended when the model's JSON does not fit, then succeeds", async () => {
    const { impl, calls } = ollamaUp((n) => (n === 0 ? '{"title": 5}' : llmAnswer()));
    const s = await serve({ fetchImpl: impl });
    const r = await (await s.post("/api/extract", { text: SOURCE, mode: "auto" })).json();
    expect(r.meta.source).toBe("ollama");
    const chats = calls.filter((c) => c.url.endsWith("/api/chat"));
    expect(chats).toHaveLength(2);
    expect(chats[1].body.messages[1].content).toMatch(/previous answer was rejected/);
    await s.close();
  });

  it("falls back to rules after two bad answers, reporting why", async () => {
    const { impl, calls } = ollamaUp(() => "not json at all");
    const s = await serve({ fetchImpl: impl });
    const r = await (await s.post("/api/extract", { text: SOURCE, mode: "auto" })).json();
    expect(r.meta.source).toBe("rules");
    expect(r.meta.fallbackReason).toMatch(/ollama failed: not valid JSON/);
    expect(calls.filter((c) => c.url.endsWith("/api/chat"))).toHaveLength(2);
    await s.close();
  });

  it("does not retry a network failure (it falls back immediately)", async () => {
    const { impl, calls } = fakeFetch((url) => {
      if (url.endsWith("/api/tags")) return json({ models: [{ name: "llama3.2:3b" }] });
      return Promise.reject(new Error("socket hang up"));
    });
    const s = await serve({ fetchImpl: impl });
    const r = await (await s.post("/api/extract", { text: SOURCE })).json();
    expect(r.meta.source).toBe("rules");
    expect(calls.filter((c) => c.url.endsWith("/api/chat"))).toHaveLength(1);
    await s.close();
  });

  it("skips Ollama (no wasted chat call) when the configured model is not installed", async () => {
    const { impl, calls } = ollamaUp(() => llmAnswer(), ["qwen2.5:7b-instruct"]);
    const s = await serve({ fetchImpl: impl });
    const r = await (await s.post("/api/extract", { text: SOURCE })).json();
    expect(r.meta.source).toBe("rules");
    expect(r.meta.fallbackReason).toMatch(/"llama3.2:3b" is not installed/);
    expect(calls.some((c) => c.url.endsWith("/api/chat"))).toBe(false);
    await s.close();
  });

  it("Gemini fails closed: requested without a key it returns rules and never calls the network", async () => {
    const { impl, calls } = unreachable();
    const s = await serve({ fetchImpl: impl });
    const r = await (await s.post("/api/extract", { text: SOURCE, mode: "gemini" })).json();
    expect(r.meta.source).toBe("rules");
    expect(r.meta.fallbackReason).toMatch(/Gemini is not configured/);
    expect(calls).toHaveLength(0);
    await s.close();
  });

  it("calls Gemini over REST when key and model are set (key in a header, not the URL)", async () => {
    const { impl, calls } = fakeFetch(async (url) =>
      url.includes("generativelanguage.googleapis.com") ? json({ candidates: [{ content: { parts: [{ text: llmAnswer() }] } }] }) : json({}, 404),
    );
    const s = await serve({ fetchImpl: impl, config: { ...CONFIG, geminiKey: "test-key", geminiModel: "gemini-test" } });
    const r = await (await s.post("/api/extract", { text: SOURCE, mode: "gemini" })).json();
    expect(r.meta).toMatchObject({ source: "gemini", model: "gemini-test" });
    expect(calls[0].url).not.toContain("test-key");
    await s.close();
  });

  it("rules mode never touches the network", async () => {
    const { impl, calls } = unreachable();
    const s = await serve({ fetchImpl: impl });
    const r = await (await s.post("/api/extract", { text: SOURCE, mode: "rules" })).json();
    expect(r.meta).toMatchObject({ source: "rules", fallbackReason: null });
    expect(calls).toHaveLength(0);
    await s.close();
  });

  it("truncates text over 6,000 characters and says so", async () => {
    const s = await serve({ fetchImpl: unreachable().impl });
    const r = await (await s.post("/api/extract", { text: SOURCE + "x".repeat(7000), mode: "rules" })).json();
    expect(r.meta.truncated).toBe(true);
    expect(r.notes.join(" ")).toMatch(/6000/);
    await s.close();
  });

  it("rejects malformed bodies with 400 (not 500)", async () => {
    const s = await serve({ fetchImpl: unreachable().impl });
    expect((await s.post("/api/extract", { text: "" })).status).toBe(400);
    expect((await s.post("/api/extract", { text: "x", mode: "magic" })).status).toBe(400);
    expect((await s.post("/api/extract", {})).status).toBe(400);
    await s.close();
  });
});

describe("POST /api/validate", () => {
  it("re-validates an edited checklist (edited mode) for live editing", async () => {
    const s = await serve({ fetchImpl: unreachable().impl });
    const extracted = await (await s.post("/api/extract", { text: SOURCE, mode: "rules" })).json();
    const checklist = extracted.proposed;
    checklist.milestones[2].amount = "1.5";
    checklist.milestones[2].conditions = [{ text: "Pilot run with 20 farmers", objective: true }];
    checklist.milestones[1].conditions = [{ text: "Prototype classifies 3 diseases", objective: true }];
    const r = await (await s.post("/api/validate", { checklist, sourceText: SOURCE })).json();
    expect(r.ambiguities.filter((a: any) => a.severity === "blocking")).toEqual([]);
    await s.close();
  });
});

describe("POST /api/confirm (the gate) and GET /api/agreements/:hash", () => {
  let dataDir: string;
  let s: Awaited<ReturnType<typeof serve>>;
  const body = (over: Record<string, unknown> = {}) => ({
    proposed: extractWithRules(SOURCE),
    edited: (() => {
      const e = extractWithRules(SOURCE);
      e.title = SAMPLE.title;
      e.milestones = SAMPLE.milestones.map((m: any, i: number) => ({
        index: i,
        title: m.title,
        amount: String(Number(BigInt(m.amountWei) / 10n ** 15n) / 1000),
        conditions: m.conditions.map((text: string) => ({ text, objective: true })),
        deadline: m.deadline,
        deliverableType: m.deliverableType,
        quote: null,
      }));
      return e;
    })(),
    sourceText: SOURCE,
    resolutions: SAMPLE.resolutions,
    addresses: { client: SAMPLE.parties.client.address, provider: SAMPLE.parties.provider.address, arbiter: SAMPLE.parties.arbiter.address },
    reviewWindowSeconds: SAMPLE.reviewWindowSeconds,
    extraction: { source: "rules", model: null },
    ...over,
  });

  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "mv-agreements-"));
    s = await serve({ fetchImpl: unreachable().impl, dataDir, now: () => new Date(SAMPLE.confirmedAt) });
  });
  afterAll(() => s.close());

  it("returns 422 with a readable list while blocking issues are unresolved, and saves nothing", async () => {
    const res = await s.post("/api/confirm", body({ resolutions: [] }));
    expect(res.status).toBe(422);
    const j = await res.json();
    expect(j.errors.length).toBeGreaterThanOrEqual(5);
    expect(j.errors.join("\n")).toMatch(/CONDITIONAL_AMOUNT:2:0/);
    expect(readdirSync(dataDir)).toEqual([]);
  });

  it("returns 422 even if the caller strips the AI flags (the gate recomputes what must be resolved)", async () => {
    const b = body({ resolutions: [] });
    (b.proposed as any).ambiguities = [];
    expect((await s.post("/api/confirm", b)).status).toBe(422);
  });

  it("returns 422 when a blocking ambiguity is only acknowledged", async () => {
    const resolutions = SAMPLE.resolutions.map((r: any) => (r.ambiguityId === "AMOUNT_MISMATCH:agreement:0" ? { ...r, action: "acknowledged" } : r));
    const res = await s.post("/api/confirm", body({ resolutions }));
    expect(res.status).toBe(422);
    expect((await res.json()).errors.join("\n")).toMatch(/AMOUNT_MISMATCH:agreement:0 is blocking/);
  });

  it("gate-check lists what is still unresolved without saving anything", async () => {
    const r = await (await s.post("/api/gate-check", body({ resolutions: [] }))).json();
    expect(r.required.map((a: any) => a.id)).toContain("MISSING_DEADLINE:2:0");
    expect(r.errors.length).toBeGreaterThan(0);
    expect(readdirSync(dataDir)).toEqual([]);
  });

  it("confirms a fully resolved checklist: the server computes the hash, saves <hash>.json and it re-hashes to the same value", async () => {
    const res = await s.post("/api/confirm", body());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.agreementHash).toBe(agreementHash(SAMPLE));
    expect(j.canonical).toBe(canonicalJSON(j.confirmed));
    const files = readdirSync(dataDir);
    expect(files).toEqual([`${j.agreementHash}.json`]);
    expect(agreementHash(JSON.parse(readFileSync(path.join(dataDir, files[0]), "utf8")))).toBe(j.agreementHash);
    const got = await s.get(`/api/agreements/${j.agreementHash}`);
    expect(got.status).toBe(200);
    expect(agreementHash(await got.json())).toBe(j.agreementHash);
  });

  it("validates the hash parameter before touching the filesystem", async () => {
    expect((await s.get("/api/agreements/..%2F..%2Fpackage.json")).status).toBe(400);
    expect((await s.get("/api/agreements/0xABCDEF")).status).toBe(400);
    expect((await s.get(`/api/agreements/0x${"0".repeat(64)}`)).status).toBe(404);
  });

  it("rejects a malformed confirm body with 400 and does not accept a client-supplied hash", async () => {
    expect((await s.post("/api/confirm", { nope: true })).status).toBe(400);
    const res = await s.post("/api/confirm", body({ agreementHash: `0x${"1".repeat(64)}` }));
    expect((await res.json()).agreementHash).toBe(agreementHash(SAMPLE)); // the extra key is ignored
  });
});

describe("GET /api/samples", () => {
  it("lists the sample agreements with their text", async () => {
    const s = await serve({ fetchImpl: unreachable().impl });
    const list = await (await s.get("/api/samples")).json();
    const k = list.find((x: any) => x.name === "krishilens.txt");
    expect(k.text).toBe(SOURCE);
    await s.close();
  });
});

describe("the server never touches the chain", () => {
  it("has no wallet, key, RPC client or transaction code under server/src (comments excluded)", () => {
    const dir = fileURLToPath(new URL("../src", import.meta.url));
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name)));
    };
    walk(dir);
    const forbidden = /JsonRpcProvider|BrowserProvider|new Wallet|sendTransaction|signTransaction|privateKey|from ["']ethers["']|\bdeployContract\b/;
    for (const f of files) {
      const code = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(forbidden.test(code), f).toBe(false);
    }
  });
});
