import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_ATTACKS, ATTACKS, CONTRAST, duelOf, scoreOf, verdictOf, type AttackRun } from "./attacks";

const TEST_DIR = fileURLToPath(new URL("../../../contracts/test", import.meta.url));
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const TEST_SOURCES = walk(TEST_DIR).map((f) => readFileSync(f, "utf8")).join("\n");

const run = (id: string, status: AttackRun["status"], ledgerOk: boolean | null = true, drained?: bigint): AttackRun => ({
  id, status, steps: [], answer: { title: "", raw: "" }, vault: null, ledger: { ok: ledgerOk, text: "" }, drained, ms: 1,
});

describe("the attack catalogue", () => {
  it("has the twelve attacks plus one contrast, with unique ids and a plain sentence for each", () => {
    expect(ATTACKS).toHaveLength(12);
    expect(ALL_ATTACKS).toHaveLength(13);
    expect(new Set(ALL_ATTACKS.map((a) => a.id)).size).toBe(13);
    for (const a of ALL_ATTACKS) {
      expect(a.tries.length).toBeGreaterThan(20);
      expect(a.requirement).toMatch(/R\d+/);
      expect(a.tests.length).toBeGreaterThan(0);
    }
    expect(ALL_ATTACKS.filter((a) => a.contrast)).toEqual([CONTRAST]);
  });

  it("marks exactly the four booklet attacks, mapped to the four required test names", () => {
    const booklet = ATTACKS.filter((a) => a.booklet);
    expect(booklet.map((a) => a.tests[0])).toEqual([
      "rejects a second release attempt",
      "rejects an unauthorized refund",
      "rejects an out-of-order transition",
      "blocks a re-entrancy attack",
    ]);
  });

  it("only cites tests that really exist in contracts/test (so the 'Proven in tests' links cannot drift)", () => {
    for (const a of ALL_ATTACKS) for (const t of a.tests) expect(TEST_SOURCES.includes(t), `"${t}" (cited by ${a.id}) is not in contracts/test`).toBe(true);
  });
});

describe("scoreOf (computed from the results, never hard-coded)", () => {
  it("counts passes, failures, lab errors and rows not yet run, and ignores the contrast row", () => {
    const runs: Record<string, AttackRun> = {};
    ATTACKS.slice(0, 8).forEach((a) => (runs[a.id] = run(a.id, "pass")));
    runs[ATTACKS[8].id] = run(ATTACKS[8].id, "fail", false);
    runs[ATTACKS[9].id] = run(ATTACKS[9].id, "error", null);
    runs[CONTRAST.id] = run(CONTRAST.id, "pass", false, 3n * 10n ** 18n);
    expect(scoreOf(runs)).toEqual({ total: 12, blocked: 8, failed: 1, errored: 1, notRun: 2, ledgersOk: 8, contrastDrained: 3n * 10n ** 18n });
  });

  it("reads 12 of 12 only when every attack really passed with a reconciled ledger", () => {
    const runs = Object.fromEntries(ATTACKS.map((a) => [a.id, run(a.id, "pass")]));
    expect(scoreOf(runs)).toMatchObject({ blocked: 12, failed: 0, errored: 0, notRun: 0, ledgersOk: 12, contrastDrained: null });
  });

  it("does not count a contrast row that failed to reproduce", () => {
    expect(scoreOf({ [CONTRAST.id]: run(CONTRAST.id, "fail", null) }).contrastDrained).toBeNull();
  });
});

describe("verdictOf", () => {
  const second = ATTACKS[0];
  const force = ATTACKS.find((a) => a.id === "force-send")!;
  it("says Blocked, Absorbed, FAILED or Lab error: a failure is never dressed up as a block", () => {
    expect(verdictOf(second, run(second.id, "pass"))).toEqual({ word: "Blocked", tone: "blocked" });
    expect(verdictOf(force, run(force.id, "pass"))).toEqual({ word: "Absorbed", tone: "blocked" });
    expect(verdictOf(second, run(second.id, "fail"))).toEqual({ word: "FAILED", tone: "fail" });
    expect(verdictOf(second, run(second.id, "error"))).toEqual({ word: "Lab error", tone: "error" });
    expect(verdictOf(second, undefined)).toEqual({ word: "Not run", tone: "wait" });
  });
  it("calls a drained naive escrow Unsafe, and a contrast that did not drain 'Did not reproduce'", () => {
    expect(verdictOf(CONTRAST, run(CONTRAST.id, "pass"))).toEqual({ word: "Unsafe", tone: "unsafe" });
    expect(verdictOf(CONTRAST, run(CONTRAST.id, "fail")).word).toBe("Did not reproduce");
  });
});

describe("duelOf (the same-attack-two-escrows card)", () => {
  const eth = (n: bigint) => n * 10n ** 18n;
  const withFigures = (r: AttackRun, figures: AttackRun["figures"]): AttackRun => ({ ...r, figures });
  const real = withFigures(run("reentrancy", "pass"), { owed: eth(1n), took: eth(1n), lost: 0n, reentries: 5, stopped: 5, guard: "ReentrancyGuardReentrantCall" });
  const naive = withFigures(run(CONTRAST.id, "pass", null, eth(3n)), { owed: eth(1n), took: eth(4n), lost: eth(3n), left: 0n });

  it("compares the two runs when both behaved as expected", () => {
    const d = duelOf({ reentrancy: real, [CONTRAST.id]: naive });
    expect(d).not.toBeNull();
    expect(d!.naive.lost).toBe(eth(3n));
    expect(d!.sealstone.lost).toBe(0n);
    expect(d!.ledgerOk).toBe(true);
  });
  it("shows nothing until both runs exist", () => {
    expect(duelOf({})).toBeNull();
    expect(duelOf({ reentrancy: real })).toBeNull();
    expect(duelOf({ [CONTRAST.id]: naive })).toBeNull();
  });
  it("never shows a flattering card when either run failed or errored", () => {
    expect(duelOf({ reentrancy: { ...real, status: "fail" }, [CONTRAST.id]: naive })).toBeNull();
    expect(duelOf({ reentrancy: real, [CONTRAST.id]: { ...naive, status: "error" } })).toBeNull();
  });
  it("does not say the books balance unless the vault's own reconcile() said so", () => {
    expect(duelOf({ reentrancy: { ...real, ledger: { ok: false, text: "" } }, [CONTRAST.id]: naive })!.ledgerOk).toBe(false);
  });
});
