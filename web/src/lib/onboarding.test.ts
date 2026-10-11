import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { matchRoute } from "./router";
import { KEYS, LOCAL_CTX, TOUR, TOUR_OFF, chaptersFor, intentLabel, isConnected, isLast, readKey, removeKey, stepsFor, tourReducer, tourSeen, writeKey } from "./onboarding";

const SRC = fileURLToPath(new URL("..", import.meta.url));
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(p) && !p.endsWith(".test.ts") ? [p] : [];
  });
}
const SOURCES = walk(SRC).map((f) => readFileSync(f, "utf8")).join("\n");

describe("the tour's content", () => {
  it("has unique steps that open and close with a centred card", () => {
    expect(new Set(TOUR.map((s) => s.id)).size).toBe(TOUR.length);
    expect(TOUR[0]).toMatchObject({ id: "welcome", modal: true });
    expect(TOUR[TOUR.length - 1]).toMatchObject({ id: "done", modal: true });
  });

  it("covers every part of the product, the AI model choice included", () => {
    const ids = TOUR.map((s) => s.id);
    for (const must of ["roles", "wallet", "ai", "chain", "controls", "money", "vaults", "studio-steps", "studio-paste", "vault-seal", "your-move", "milestones", "verify", "ledger", "withdraw", "lab", "duel"]) {
      expect(ids, `missing the "${must}" step`).toContain(must);
    }
    const ai = TOUR.find((s) => s.id === "ai")!;
    const text = [ai.body, ai.note, ...(ai.points ?? []).map((p) => `${p.k} ${p.v}`)].join(" ");
    for (const word of ["Auto", "Ollama", "Gemini", "Rules", "offline", "never touches the chain"]) expect(text).toContain(word);
  });

  it("groups steps into contiguous chapters", () => {
    const seen = new Set<string>();
    let prev = "";
    for (const s of TOUR) {
      if (s.chapter !== prev) {
        expect(seen.has(s.chapter), `chapter "${s.chapter}" is split in two`).toBe(false);
        seen.add(s.chapter);
        prev = s.chapter;
      }
    }
    expect(chaptersFor("full").reduce((n, c) => n + c.count, 0)).toBe(TOUR.length);
  });

  it("sends every step to a real page and gives each spotlight a selector", () => {
    for (const s of TOUR) {
      for (const ctx of [LOCAL_CTX, { net: "wallet", vault: VAULT_ADDR } as const]) {
        const to = s.route?.(ctx);
        if (to) expect(matchRoute(to).name, `${s.id} points at a page that doesn't exist`).not.toBe("notfound");
      }
      if (!s.modal) expect(s.anchor, `${s.id} has nothing to point at`).toBeTruthy();
      expect(s.body.length).toBeGreaterThan(40);
    }
  });

  it("only points at elements that exist in the source (so the tour cannot drift from the screens)", () => {
    for (const s of TOUR) {
      for (const sel of (s.anchor ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
        const name = /data-tour="([^"]+)"/.exec(sel)?.[1];
        expect(name, `${s.id}: unsupported selector ${sel}`).toBeTruthy();
        expect(SOURCES.includes(`data-tour="${name}"`), `${s.id}: nothing in the app is marked data-tour="${name}"`).toBe(true);
      }
    }
  });

  it("has a quick tour that is a strict subset starting with the welcome and ending with the finish", () => {
    const quick = stepsFor("quick");
    expect(quick.length).toBeGreaterThan(4);
    expect(quick.length).toBeLessThan(TOUR.length);
    expect(quick[0].id).toBe("welcome");
    expect(quick[quick.length - 1].id).toBe("done");
    expect(quick.every((s) => TOUR.includes(s))).toBe(true);
  });
});

const VAULT_ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

describe("the tour with a real wallet on MST testnet", () => {
  const wallet = { net: "wallet", vault: VAULT_ADDR } as const;
  it("drops the Attack Lab, which needs the local sandbox accounts", () => {
    const ids = stepsFor("full", wallet).map((s) => s.id);
    expect(ids).not.toContain("lab");
    expect(ids).not.toContain("duel");
    expect(stepsFor("full").map((s) => s.id)).toContain("lab");
  });
  it("shows the vault chapter only when this browser has a vault of its own", () => {
    expect(stepsFor("full", { net: "wallet", vault: null }).some((s) => s.chapter === "Inside a vault")).toBe(false);
    const withVault = stepsFor("full", wallet).filter((s) => s.chapter === "Inside a vault");
    expect(withVault.length).toBeGreaterThan(3);
    expect(withVault[0].route?.(wallet)).toBe(`/vault/${VAULT_ADDR}`);
  });
  it("says the wallet decides the role, and never mentions switching test accounts", () => {
    const text = stepsFor("full", wallet).map((s) => `${s.title} ${s.body} ${s.phoneBody ?? ""} ${s.note ?? ""}`).join(" ");
    expect(text).toMatch(/switch accounts in your wallet/i);
    expect(text).not.toMatch(/press 1, 2, 3 or 4/i);
    expect(text).toMatch(/MST Testnet/);
  });
  it("still covers the AI model choice", () => {
    const ai = stepsFor("full", wallet).find((s) => s.id === "ai");
    expect(ai?.points?.map((p) => p.k)).toEqual(["Auto", "Ollama", "Gemini", "Rules (offline)"]);
  });
  it("keeps the chapter counts honest", () => {
    expect(chaptersFor("full", wallet).reduce((n, c) => n + c.count, 0)).toBe(stepsFor("full", wallet).length);
  });
});

describe("tourReducer", () => {
  const started = tourReducer(TOUR_OFF, { type: "start", from: "/vaults", ctx: LOCAL_CTX });
  it("starts at the first step and remembers where the person was", () => {
    expect(started).toMatchObject({ active: true, mode: "full", index: 0, returnTo: "/vaults" });
  });
  it("moves forward and back, and never past either end", () => {
    let s = tourReducer(started, { type: "back" });
    expect(s.index).toBe(0);
    for (let i = 0; i < 100; i++) s = tourReducer(s, { type: "next" });
    expect(s.index).toBe(TOUR.length - 1);
    expect(isLast(s)).toBe(true);
    expect(tourReducer(s, { type: "back" }).index).toBe(TOUR.length - 2);
  });
  it("switching to the quick tour starts it from the top", () => {
    const s = tourReducer(tourReducer(started, { type: "next" }), { type: "mode", mode: "quick" });
    expect(s).toMatchObject({ mode: "quick", index: 0 });
  });
  it("jumps to a step, clamped, and stops without forgetting the way back", () => {
    expect(tourReducer(started, { type: "goto", index: 999 }).index).toBe(TOUR.length - 1);
    expect(tourReducer(started, { type: "goto", index: -4 }).index).toBe(0);
    const stopped = tourReducer(started, { type: "stop" });
    expect(stopped.active).toBe(false);
    expect(stopped.returnTo).toBe("/vaults");
  });
  it("ignores next and back while the tour is off", () => {
    expect(tourReducer(TOUR_OFF, { type: "next" })).toBe(TOUR_OFF);
    expect(tourReducer(TOUR_OFF, { type: "back" })).toBe(TOUR_OFF);
  });
});

describe("remembering the person", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    removeKey(KEYS.wallet);
    removeKey(KEYS.tour);
  });

  it("is not connected and has not seen the tour on a first visit", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    removeKey(KEYS.wallet);
    expect(isConnected()).toBe(false);
    expect(tourSeen()).toBe(false);
  });

  it("remembers a connection and a finished or skipped tour", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    writeKey(KEYS.wallet, "demo");
    writeKey(KEYS.tour, "skipped");
    expect(isConnected()).toBe(true);
    expect(tourSeen()).toBe(true);
    removeKey(KEYS.wallet);
    expect(isConnected()).toBe(false);
  });

  it("still remembers for this session when the browser blocks storage, and never throws", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(() => writeKey(KEYS.wallet, "demo")).not.toThrow();
    expect(readKey(KEYS.wallet)).toBe("demo");
    expect(isConnected()).toBe(true);
    expect(() => removeKey(KEYS.wallet)).not.toThrow();
    expect(isConnected()).toBe(false);
  });
});

describe("intentLabel", () => {
  it("says where the person was heading, so the connect screen can say it back", () => {
    expect(intentLabel("/attack-lab")).toBe("the Attack Lab");
    expect(intentLabel("/agreement")).toBe("the Agreement studio");
    expect(intentLabel("/vault/0x5FbDB2315678afecb367f032d93F642f64180aa3")).toBe("this vault");
    expect(intentLabel("/dashboard")).toBe("the dashboard");
  });
});
