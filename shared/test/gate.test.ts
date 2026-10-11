import { describe, expect, it } from "vitest";
import { GateError, agreementHash, assertConfirmable, checkGate, confirmedChecklistSchema, type GateInput } from "../src/index";
import { SAMPLE, SOURCE, cond, krishiEdited, krishiGateInput, krishiProposed } from "./fixtures";

const errorsOf = (input: GateInput): string[] => {
  try {
    assertConfirmable(input);
  } catch (e) {
    if (e instanceof GateError) return e.errors;
    throw e;
  }
  return [];
};

describe("confirmation gate: accepts a fully resolved agreement", () => {
  it("returns a ConfirmedChecklist that re-validates against the strict schema", () => {
    const confirmed = assertConfirmable(krishiGateInput());
    expect(confirmedChecklistSchema.safeParse(confirmed).success).toBe(true);
    expect(confirmed.milestones.map((m) => m.amountWei)).toEqual(["1000000000000000000", "2500000000000000000", "1500000000000000000"]);
  });

  it("CONSISTENCY: the live pipeline reproduces the pre-seeded sample byte for byte (same agreementHash)", () => {
    const confirmed = assertConfirmable(krishiGateInput());
    expect(agreementHash(confirmed)).toBe(agreementHash(SAMPLE));
  });

  it("the required set is exactly the five ambiguities the sample resolves", () => {
    const { required } = checkGate(krishiGateInput());
    expect(required.map((a) => a.id).sort()).toEqual(SAMPLE.resolutions.map((r: any) => r.ambiguityId).sort());
  });

  it("an unedited 'remaining funds' milestone does not add a duplicate MISSING_AMOUNT card on top of CONDITIONAL_AMOUNT", () => {
    const { required } = checkGate(krishiGateInput({ edited: krishiProposed(), resolutions: [] }));
    expect(required.map((a) => a.id)).not.toContain("MISSING_AMOUNT:2:0");
    expect(required).toHaveLength(5);
  });

  it("accepts lowercase addresses and normalises them to the checksummed form", () => {
    const input = krishiGateInput();
    input.addresses = { client: input.addresses.client.toLowerCase(), provider: input.addresses.provider.toLowerCase(), arbiter: input.addresses.arbiter.toLowerCase() };
    expect(assertConfirmable(input).parties.client.address).toBe(SAMPLE.parties.client.address);
  });
});

describe("confirmation gate: rejects each unmet condition separately", () => {
  it("rule 1: no resolutions at all lists every unresolved ambiguity", () => {
    const errors = errorsOf(krishiGateInput({ resolutions: [] }));
    for (const r of SAMPLE.resolutions) expect(errors.some((e) => e.includes(r.ambiguityId)), r.ambiguityId).toBe(true);
  });

  it("rule 1: one missing resolution is reported by id", () => {
    const errors = errorsOf(krishiGateInput({ resolutions: SAMPLE.resolutions.slice(1) }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(SAMPLE.resolutions[0].ambiguityId);
  });

  it("rule 1: a caller that sends an EMPTY AI-flag list cannot skip the validator's flags", () => {
    const input = krishiGateInput({ resolutions: [] });
    input.proposed.ambiguities = [];
    expect(errorsOf(input).length).toBeGreaterThanOrEqual(5);
  });

  it("rule 2: acknowledging a blocking ambiguity is not enough", () => {
    const resolutions = SAMPLE.resolutions.map((r: any) => (r.ambiguityId === "CONDITIONAL_AMOUNT:2:0" ? { ...r, action: "acknowledged" } : r));
    const errors = errorsOf(krishiGateInput({ resolutions }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/CONDITIONAL_AMOUNT:2:0 is blocking/);
  });

  it("rule 2: acknowledging a WARNING is fine (the M3 deadline sample does exactly that)", () => {
    const r = SAMPLE.resolutions.find((x: any) => x.ambiguityId === "MISSING_DEADLINE:2:0");
    expect(r.action).toBe("acknowledged");
    expect(errorsOf(krishiGateInput())).toEqual([]);
  });

  it("rule 3: an edit that leaves a blocking issue is rejected even though everything is 'resolved'", () => {
    const edited = krishiEdited();
    edited.milestones[2].amount = null; // the human 'resolved' the flag but never entered a figure
    const errors = errorsOf(krishiGateInput({ edited }));
    expect(errors.join("\n")).toMatch(/MISSING_AMOUNT:2:0/);
    expect(errors.join("\n")).toMatch(/needs a positive amount/);
  });

  it("rule 3: an edit that CREATES a new blocking issue is rejected (a new conditional clause)", () => {
    const edited = krishiEdited();
    edited.milestones[0].conditions.push(cond("Plus a 10% bonus on early delivery"));
    expect(errorsOf(krishiGateInput({ edited })).join("\n")).toMatch(/Still blocking after editing: CONDITIONAL_AMOUNT:0:0/);
  });

  it("rule 3: a total that no longer matches the edited amounts is rejected", () => {
    const edited = krishiEdited();
    edited.totalStated = "6";
    expect(errorsOf(krishiGateInput({ edited })).join("\n")).toMatch(/AMOUNT_MISMATCH/);
  });

  it("an edit that creates a new WARNING must be resolved too", () => {
    const edited = krishiEdited();
    edited.milestones[0].conditions.push(cond("Delivered in a timely fashion"));
    const errors = errorsOf(krishiGateInput({ edited }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Unresolved warning ambiguity VAGUE_CONDITION:0:0/);
  });

  it("rule 4: duplicate addresses are rejected", () => {
    const input = krishiGateInput();
    input.addresses.arbiter = input.addresses.client;
    expect(errorsOf(input).join("\n")).toMatch(/three different wallet addresses/);
  });

  it("rule 4: a missing or invalid address is rejected, naming the role", () => {
    const input = krishiGateInput();
    input.addresses.provider = "not-an-address";
    input.addresses.arbiter = "";
    const errors = errorsOf(input).join("\n");
    expect(errors).toMatch(/provider/);
    expect(errors).toMatch(/arbiter/);
  });

  it("rejects an unknown resolution id, a duplicate resolution and a note that is too short", () => {
    const base = SAMPLE.resolutions;
    expect(errorsOf(krishiGateInput({ resolutions: [...base, { ...base[0], ambiguityId: "MISSING_PARTY:agreement:0" }] })).join("\n")).toMatch(/unknown ambiguity/);
    expect(errorsOf(krishiGateInput({ resolutions: [...base, base[0]] })).join("\n")).toMatch(/Duplicate resolution/);
    expect(errorsOf(krishiGateInput({ resolutions: [{ ...base[0], note: "ok" }, ...base.slice(1)] })).join("\n")).toMatch(/Invalid resolution/);
  });

  it("rejects a zero review window and an unnamed party", () => {
    expect(errorsOf(krishiGateInput({ reviewWindowSeconds: 0 })).join("\n")).toMatch(/review window/);
    const edited = krishiEdited();
    edited.parties.arbiter.name = null;
    expect(errorsOf(krishiGateInput({ edited })).join("\n")).toMatch(/arbiter needs a name/);
  });

  it("reports EVERY unmet condition at once in a single GateError", () => {
    const input = krishiGateInput({ resolutions: [], reviewWindowSeconds: 0 });
    input.addresses.arbiter = input.addresses.client;
    const errors = errorsOf(input);
    expect(errors.length).toBeGreaterThanOrEqual(7);
    expect(() => assertConfirmable(input)).toThrow(GateError);
  });

  it("grounding still bites through rule 2: an invented amount in the PROPOSAL must be edited, not acknowledged", () => {
    const proposed = krishiProposed();
    proposed.milestones[0].amount = "100";
    const resolutions = [...SAMPLE.resolutions, { ambiguityId: "AMOUNT_NOT_IN_TEXT:0:0", action: "acknowledged", note: "looks fine to me", resolvedBy: "client" }];
    expect(errorsOf(krishiGateInput({ proposed, resolutions })).join("\n")).toMatch(/AMOUNT_NOT_IN_TEXT:0:0 is blocking/);
    const fixed = resolutions.map((r: any) => (r.ambiguityId === "AMOUNT_NOT_IN_TEXT:0:0" ? { ...r, action: "edited" } : r));
    expect(errorsOf(krishiGateInput({ proposed, resolutions: fixed }))).toEqual([]);
  });
});

describe("the source text used by the gate", () => {
  it("is CRLF-normalised, so Windows and Unix produce the same sourceTextHash", () => {
    const crlf = SOURCE.replace(/\n/g, "\r\n");
    expect(assertConfirmable(krishiGateInput({ sourceText: crlf })).extraction.sourceTextHash).toBe(SAMPLE.extraction.sourceTextHash);
  });
});
