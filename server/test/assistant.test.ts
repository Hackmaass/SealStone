import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ruleReply, sanitizeActions, type AssistantContext } from "@mv/shared";
import { createApp } from "../src/app";
import type { AiConfig } from "../src/ai";

const VAULT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const CTX: AssistantContext = {
  path: "/dashboard",
  role: "client",
  roleName: "Incubation Cell",
  chainOnline: true,
  vaults: [{ address: VAULT, title: "KrishiLens incubation grant", state: "Active", next: "Approve or dispute milestone 1.", mine: true, ledgerOk: true }],
};
const BASE_CONFIG: AiConfig = { ollamaUrl: "http://ollama.test", ollamaModel: "qwen2.5:7b-instruct", geminiKey: "", geminiModel: "", llmTimeoutMs: 2000 };
const WITH_SARVAM: AiConfig = { ...BASE_CONFIG, sarvamKey: "test-key-not-real", sarvamModel: "sarvam-test" };

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const sarvamSays = (content: string) => json({ choices: [{ finish_reason: "stop", message: { content } }] });

function fakeFetch(handler: (url: string, init: any) => Response | Promise<Response>) {
  const calls: Array<{ url: string; headers: any; body: any }> = [];
  const impl = (async (input: any, init?: any) => {
    const url = String(input);
    calls.push({ url, headers: init?.headers, body: init?.body ? JSON.parse(init.body) : undefined });
    return handler(url, init);
  }) as typeof fetch;
  return { impl, calls };
}
const noNetwork = () => fakeFetch(() => Promise.reject(new TypeError("fetch failed: ENOTFOUND")));

async function serve(fetchImpl: typeof fetch, config: AiConfig) {
  const app = createApp({ config, fetchImpl });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (p: string, body: unknown) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { post, get: (p: string) => fetch(base + p), close: () => new Promise<void>((r) => server.close(() => r())) };
}
const ask = (text: string, mode = "auto") => ({ messages: [{ role: "user", text }], context: CTX, mode });

describe("the assistant only proposes", () => {
  it("accepts navigation, open-vault, role and theme suggestions and drops everything else, including any money-moving action", () => {
    const kept = sanitizeActions(
      [
        { type: "navigate", to: "/attack-lab", label: "Open the Attack Lab" },
        { type: "approve", milestone: 0, label: "Approve it" },
        { type: "sendTransaction", to: VAULT, label: "Pay" },
        { type: "navigate", to: "https://evil.example", label: "Go" },
        { type: "openVault", address: "0x1111111111111111111111111111111111111111", label: "Unknown vault" },
        { type: "openVault", address: VAULT, label: "Open the grant" },
      ],
      CTX,
    );
    expect(kept.map((a) => a.type)).toEqual(["navigate", "openVault"]);
  });

  it("uses Sarvam when it is configured: the right endpoint and header, the key never in the body or the answer", async () => {
    const f = fakeFetch((url) => (url.includes("api.sarvam.ai") ? sarvamSays(JSON.stringify({ reply: "Open the Attack Lab and press Run all attacks.", actions: [{ type: "navigate", to: "/attack-lab", label: "Open the Attack Lab" }, { type: "withdraw", label: "Take the money" }] })) : json({}, 404)));
    const s = await serve(f.impl, WITH_SARVAM);
    const r = await s.post("/api/assistant", ask("show me the attacks"));
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.meta).toMatchObject({ source: "sarvam", model: "sarvam-test", fallbackReason: null });
    expect(body.actions).toEqual([{ type: "navigate", to: "/attack-lab", label: "Open the Attack Lab" }]);
    const call = f.calls.find((c) => c.url.includes("api.sarvam.ai"))!;
    expect(call.url).toBe("https://api.sarvam.ai/v1/chat/completions");
    expect(call.headers["api-subscription-key"]).toBe("test-key-not-real");
    expect(JSON.stringify(call.body)).not.toContain("test-key-not-real");
    expect(JSON.stringify(body)).not.toContain("test-key-not-real");
    expect(call.body.messages[0].content).toMatch(/NEVER sign, fund, approve/);
    await s.close();
  });

  it("keeps plain words when the model ignores the JSON format, and offers no actions", async () => {
    const f = fakeFetch(() => sarvamSays("You can open the dashboard from the menu."));
    const s = await serve(f.impl, WITH_SARVAM);
    const body = await (await s.post("/api/assistant", ask("hello"))).json();
    expect(body).toMatchObject({ reply: "You can open the dashboard from the menu.", actions: [], meta: { source: "sarvam" } });
    await s.close();
  });

  it("falls back to the built-in rules (and says why) when Sarvam fails and no local model is reachable", async () => {
    const f = fakeFetch((url) => (url.includes("api.sarvam.ai") ? json({ error: "x" }, 500) : Promise.reject(new TypeError("fetch failed"))));
    const s = await serve(f.impl, WITH_SARVAM);
    const body = await (await s.post("/api/assistant", ask("take me to the attack lab"))).json();
    expect(body.meta.source).toBe("rules");
    expect(body.meta.fallbackReason).toMatch(/Sarvam failed: Sarvam HTTP 500/);
    expect(body.actions).toEqual([{ type: "navigate", to: "/attack-lab", label: "Open the Attack Lab" }]);
    await s.close();
  });

  it("makes no outside request at all in rules mode (Wi-Fi-off behaviour) and still answers", async () => {
    const f = noNetwork();
    const s = await serve(f.impl, WITH_SARVAM);
    const body = await (await s.post("/api/assistant", ask("what is next for me?", "rules"))).json();
    expect(f.calls).toHaveLength(0);
    expect(body.meta.source).toBe("rules");
    expect(body.reply).toMatch(/waiting on Incubation Cell/);
    expect(body.actions[0]).toMatchObject({ type: "openVault", address: VAULT });
    await s.close();
  });

  it("refuses to pretend it can move money: a request to approve or withdraw is explained, never performed", () => {
    for (const text of ["approve milestone 1 for me", "withdraw my money", "release the funds now", "send 1 ETH"]) {
      const r = ruleReply(text, CTX);
      expect(r.reply, text).toMatch(/never move money/i);
      expect(r.actions.every((a) => a.type === "openVault")).toBe(true);
    }
  });

  it("rejects a conversation that does not end with a user message, and an invalid body", async () => {
    const s = await serve(noNetwork().impl, BASE_CONFIG);
    expect((await s.post("/api/assistant", { messages: [{ role: "assistant", text: "hi" }], context: CTX })).status).toBe(400);
    expect((await s.post("/api/assistant", { messages: [], context: CTX })).status).toBe(400);
    await s.close();
  });

  it("the assistant code cannot send a transaction: no chain library, wallet or RPC anywhere in it", () => {
    for (const rel of ["../src/ai/assistant.ts", "../src/ai/llm.ts", "../src/ai/evidence.ts", "../../shared/src/assistant.ts"]) {
      const code = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(/from ["']ethers["']|JsonRpcProvider|BrowserProvider|new Wallet|eth_sendTransaction|useTx|vaultContract|deployVault|window\.ethereum/.test(code), rel).toBe(false);
    }
  });
});

describe("POST /api/evidence (advisory arbiter brief and approval review)", () => {
  const CONDITIONS = ["The demo detects at least 3 diseases with 80% confidence", "A written report is delivered to the mentor"];
  const TEXTS = { client: "The demo only recognised 1 of the 3 sample diseases, so the 80% confidence target was missed.", provider: "We showed the demo and a written report was emailed to the mentor on 12 December." };

  it("keeps a claim only when a verbatim quote backs it, and downgrades an invented one", async () => {
    const llm = {
      items: [
        { index: 0, status: "supported", clientPoints: ["only 1 of 3"], providerPoints: [], quotes: [{ from: "client", text: "only recognised 1 of the 3 sample diseases" }] },
        { index: 1, status: "supported", clientPoints: [], providerPoints: ["report sent"], quotes: [{ from: "provider", text: "the signed report was uploaded to the vault" }] },
      ],
    };
    const s = await serve(fakeFetch(() => sarvamSays(JSON.stringify(llm))).impl, WITH_SARVAM);
    const body = await (await s.post("/api/evidence", { kind: "brief", conditions: CONDITIONS, texts: TEXTS })).json();
    expect(body.meta.source).toBe("sarvam");
    expect(body.items[0]).toMatchObject({ status: "supported", downgraded: false, quotes: [{ from: "client", text: "only recognised 1 of the 3 sample diseases" }] });
    expect(body.items[1]).toMatchObject({ status: "not-addressed", downgraded: true, quotes: [] });
    await s.close();
  });

  it("replaces a status the model invented, and never emits a ruling field", async () => {
    const llm = { items: [{ index: 0, status: "client wins", quotes: [] }] };
    const s = await serve(fakeFetch(() => sarvamSays(JSON.stringify(llm))).impl, WITH_SARVAM);
    const body = await (await s.post("/api/evidence", { kind: "brief", conditions: CONDITIONS, texts: TEXTS })).json();
    expect(body.items[0].status).toBe("not-addressed");
    expect(JSON.stringify(body)).not.toMatch(/ruling|release|refund|winner|client wins/i);
    await s.close();
  });

  it("works with no model at all: the rules brief marks a condition contested when both sides address it", async () => {
    const s = await serve(noNetwork().impl, BASE_CONFIG);
    const body = await (
      await s.post("/api/evidence", {
        kind: "brief",
        mode: "rules",
        conditions: CONDITIONS,
        texts: { client: "The demo detects 1 disease only, so 3 diseases with 80% confidence was not met. No report arrived.", provider: "The demo detects 3 diseases with 80% confidence. A written report was delivered to the mentor." },
      })
    ).json();
    expect(body.meta.source).toBe("rules");
    expect(body.items.map((i: any) => i.status)).toEqual(["contested", "supported"]);
    expect(body.items[0].quotes.length).toBe(2);
    await s.close();
  });

  it("review: the rules reader finds a condition in the delivered text, and says not-found when it is absent", async () => {
    const s = await serve(noNetwork().impl, BASE_CONFIG);
    const body = await (
      await s.post("/api/evidence", { kind: "review", mode: "rules", conditions: CONDITIONS, texts: { deliverable: "Results: the demo detects 3 diseases with 80% confidence on the sample photos." } })
    ).json();
    expect(body.items[0].status).toBe("appears-met");
    expect(body.items[1].status).toBe("not-found");
    await s.close();
  });

  it("review (rules only): reads the demo report's text against the real KrishiLens milestone 1 conditions", async () => {
    const report = readFileSync(fileURLToPath(new URL("../../web/public/demo/m1-report.txt", import.meta.url)), "utf8");
    const conditions = ["Written report of at least 8 pages is delivered", "Report covers interviews with at least 10 farmers", "Report ranks the five most common crop diseases in the pilot region"];
    const s = await serve(noNetwork().impl, BASE_CONFIG);
    const ok = await (await s.post("/api/evidence", { kind: "review", mode: "rules", conditions, texts: { deliverable: report } })).json();
    expect(ok.items.map((i: any) => i.status)).toEqual(["appears-met", "appears-met", "appears-met"]);
    // "at least 8 pages" is NOT met by a 5-page report, and "at least 10 farmers" is not met by 7 farmers.
    const thin = await (await s.post("/api/evidence", { kind: "review", mode: "rules", conditions, texts: { deliverable: "This report runs to 5 pages. We interviewed 7 farmers in one village." } })).json();
    expect(thin.items[0].status).not.toBe("appears-met");
    expect(thin.items[1].status).not.toBe("appears-met");
    expect(thin.items[2].status).toBe("not-found");
    await s.close();
  });

  it("validates its input", async () => {
    const s = await serve(noNetwork().impl, BASE_CONFIG);
    expect((await s.post("/api/evidence", { kind: "brief", conditions: [], texts: {} })).status).toBe(400);
    expect((await s.post("/api/evidence", { kind: "ruling", conditions: ["x"], texts: {} })).status).toBe(400);
    await s.close();
  });
});
