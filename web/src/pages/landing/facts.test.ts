import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMAND, FACTS, FAQS } from "./facts";

const README = readFileSync(new URL("../../../../README.md", import.meta.url), "utf8");

describe("the landing page's facts agree with the README (one source of truth)", () => {
  it("quotes the contract test count, coverage and fuzz size that the README reports", () => {
    expect(README).toContain(`**${FACTS.contractTests} passing**`);
    expect(README).toContain(`**${FACTS.coverageLines}%** lines`);
    expect(README).toMatch(new RegExp(`5 seeds × 200 steps = ${FACTS.fuzzSteps.toLocaleString("en-US")} steps`));
    expect(README).toContain(`I1–I${FACTS.invariants}`);
  });

  it("quotes the same attacks and the same four booklet tests", () => {
    expect(FACTS.attacksBlocked).toBe(FACTS.attacksTotal);
    expect(README).toContain("Attack Lab");
    for (const name of ["rejects a second release attempt", "rejects an unauthorized refund", "rejects an out-of-order transition", "blocks a re-entrancy attack"]) {
      expect(README).toContain(name);
    }
    expect(FACTS.bookletTests).toBe(4);
    expect(README).toContain(`drains ${FACTS.naiveDrainedEth}.000 ETH`);
  });

  it("the run-it-yourself command is the one the README documents", () => {
    expect(README).toContain(COMMAND);
  });

  it("has an answer for every question, and no placeholder text", () => {
    expect(FAQS.length).toBeGreaterThanOrEqual(6);
    for (const f of FAQS) {
      expect(f.q.endsWith("?")).toBe(true);
      expect(f.a.length).toBeGreaterThan(60);
      expect(/lorem|todo|tbd/i.test(f.q + f.a)).toBe(false);
    }
  });
});
