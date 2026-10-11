import { describe, expect, it } from "vitest";
import { ambiguityId, mergeAmbiguities, type Ambiguity, type AmbiguityType } from "../src/index";

const mk = (type: AmbiguityType, milestoneIndex: number | null, over: Partial<Ambiguity> = {}): Ambiguity => ({
  id: "ignored",
  origin: "ai",
  type,
  severity: "blocking",
  milestoneIndex,
  quote: null,
  message: `${type} message`,
  question: "?",
  suggestedResolutions: [],
  ...over,
});

describe("mergeAmbiguities", () => {
  it("de-duplicates on (type, milestoneIndex) and gives stable ids", () => {
    const merged = mergeAmbiguities([mk("MISSING_DEADLINE", 2), mk("MISSING_DEADLINE", 2)], [mk("MISSING_DEADLINE", 2, { origin: "validator" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("MISSING_DEADLINE:2:0");
    expect(ambiguityId("PARTY_CONFLICT", null)).toBe("PARTY_CONFLICT:agreement:0");
  });

  it("the validator's severity wins when both flagged the same thing", () => {
    const merged = mergeAmbiguities([mk("VAGUE_CONDITION", 0, { severity: "warning" })], [mk("VAGUE_CONDITION", 0, { origin: "validator", severity: "blocking" })]);
    expect(merged[0].severity).toBe("blocking");
    expect(merged[0].origin).toBe("ai"); // provenance: the AI saw it first
  });

  it("the validator can escalate but never removes an AI flag", () => {
    const ai = [mk("CONDITIONAL_AMOUNT", 1), mk("MISSING_PARTY", null)];
    const merged = mergeAmbiguities(ai, []);
    expect(merged.map((a) => a.id).sort()).toEqual(["CONDITIONAL_AMOUNT:1:0", "MISSING_PARTY:agreement:0"]);
  });

  it("an AI-only VAGUE_CONDITION is a warning: only the validator can make it blocking", () => {
    const merged = mergeAmbiguities([mk("VAGUE_CONDITION", 0, { severity: "blocking" })], []);
    expect(merged[0].severity).toBe("warning");
  });

  it("a model cannot downgrade a blocking type: severity comes from the table, not from the model", () => {
    const merged = mergeAmbiguities([mk("MISSING_AMOUNT", 0, { severity: "warning" })], []);
    expect(merged[0].severity).toBe("blocking");
  });

  it("adds validator-only flags and orders agreement-level first, then by milestone", () => {
    const merged = mergeAmbiguities([mk("MISSING_DEADLINE", 2)], [mk("AMOUNT_MISMATCH", null, { origin: "validator" }), mk("CONDITIONAL_AMOUNT", 1, { origin: "validator" })]);
    expect(merged.map((a) => a.id)).toEqual(["AMOUNT_MISMATCH:agreement:0", "CONDITIONAL_AMOUNT:1:0", "MISSING_DEADLINE:2:0"]);
    expect(merged[0].origin).toBe("validator");
  });
});
