import { describe, expect, it } from "vitest";
import {
  ethAmountsInText,
  llmChecklistJsonSchema,
  llmChecklistSchema,
  parseAmountWei,
  sanitizeQuotes,
  validate,
  type ProposedChecklist,
} from "../src/index";
import { CLEAN_SOURCE, SOURCE, cleanProposed, cond, emptyPartiesProposed, krishiProposed } from "./fixtures";

const ids = (p: ProposedChecklist, source = CLEAN_SOURCE, mode: "proposal" | "edited" = "proposal") =>
  validate(p, source, mode).ambiguities.map((a) => a.id).sort();
const find = (p: ProposedChecklist, id: string, source = CLEAN_SOURCE, mode: "proposal" | "edited" = "proposal") =>
  validate(p, source, mode).ambiguities.find((a) => a.id === id);

describe("validator: a clean agreement raises nothing (no false alarms)", () => {
  it("produces zero ambiguities and zero hard errors", () => {
    const r = validate(cleanProposed(), CLEAN_SOURCE);
    expect(r.ambiguities).toEqual([]);
    expect(r.hardErrors).toEqual([]);
  });
});

describe("validator V1/V2: parties", () => {
  it("V1 flags a missing party as blocking and names the missing roles", () => {
    const p = cleanProposed();
    p.parties.arbiter = { name: null, quote: null };
    const a = find(p, "MISSING_PARTY:agreement:0")!;
    expect(a.severity).toBe("blocking");
    expect(a.message).toContain("arbiter");
  });

  it("V1 treats a blank name as missing", () => {
    const p = cleanProposed();
    p.parties.provider.name = "   ";
    expect(ids(p)).toContain("MISSING_PARTY:agreement:0");
  });

  it("V1 flags all three when none is named", () => {
    expect(find(emptyPartiesProposed(), "MISSING_PARTY:agreement:0")!.message).toContain("client, provider, arbiter");
  });

  it("V2 flags the same person as client and arbiter (case/space-insensitive)", () => {
    const p = cleanProposed();
    p.parties.arbiter.name = "  a  co ";
    expect(find(p, "PARTY_CONFLICT:agreement:0")!.severity).toBe("blocking");
  });
});

describe("validator V3: milestone count", () => {
  it("reports 0 and 21 milestones as hard errors, accepts 1 and 20", () => {
    const base = cleanProposed();
    const many = (n: number): ProposedChecklist => ({
      ...base,
      totalStated: null,
      milestones: Array.from({ length: n }, (_, i) => ({ ...base.milestones[0], index: i })),
    });
    expect(validate(many(0), CLEAN_SOURCE).hardErrors).toHaveLength(1);
    expect(validate(many(21), CLEAN_SOURCE).hardErrors).toHaveLength(1);
    expect(validate(many(1), CLEAN_SOURCE).hardErrors).toEqual([]);
    expect(validate(many(20), CLEAN_SOURCE).hardErrors).toEqual([]);
  });
});

describe("validator V4: amounts present and positive", () => {
  it.each([[null], ["abc"], ["0"], ["-1"], ["1.0000000000000000001"], [""]])("flags %j as MISSING_AMOUNT", (amount) => {
    const p = cleanProposed();
    p.totalStated = null;
    p.milestones[1].amount = amount;
    expect(find(p, "MISSING_AMOUNT:1:0")!.severity).toBe("blocking");
  });

  it("accepts '2.50 ETH' and '1,000 eth' spellings exactly", () => {
    expect(parseAmountWei("2.50 ETH")).toBe(2_500_000_000_000_000_000n);
    expect(parseAmountWei("1,000 eth")).toBe(1_000n * 10n ** 18n);
    expect(parseAmountWei("0.000000000000000001")).toBe(1n);
  });
});

describe("validator V5: totals are exact (wei, no floats)", () => {
  it("flags a total that does not match the milestones", () => {
    const p = cleanProposed();
    p.totalStated = "4";
    expect(find(p, "AMOUNT_MISMATCH:agreement:0")!.severity).toBe("blocking");
  });

  it("0.1 + 0.2 equals 0.3 exactly (a float implementation would fail this)", () => {
    const p = cleanProposed();
    p.totalStated = "0.3";
    p.milestones[0].amount = "0.1";
    p.milestones[1].amount = "0.2";
    const src = "Client: A Co\nTotal: 0.3 ETH\n0.1 ETH and 0.2 ETH";
    expect(ids(p, src)).not.toContain("AMOUNT_MISMATCH:agreement:0");
  });

  it("compares the sum of the amounts that ARE present when one is missing (KrishiLens: 3.5 vs 5)", () => {
    expect(find(krishiProposed(), "AMOUNT_MISMATCH:agreement:0", SOURCE)).toBeDefined();
  });

  it("flags an unparsable stated total", () => {
    const p = cleanProposed();
    p.totalStated = "five";
    expect(find(p, "AMOUNT_MISMATCH:agreement:0")).toBeDefined();
  });

  it("does nothing when no total is stated", () => {
    const p = cleanProposed();
    p.totalStated = null;
    expect(ids(p)).not.toContain("AMOUNT_MISMATCH:agreement:0");
  });
});

describe("validator V6/V7: conditions", () => {
  it("V6 flags a milestone with no conditions as blocking", () => {
    const p = cleanProposed();
    p.milestones[0].conditions = [];
    expect(find(p, "VAGUE_CONDITION:0:0")!.severity).toBe("blocking");
  });

  it("V6 flags a milestone whose only condition is vague as blocking", () => {
    const p = cleanProposed();
    p.milestones[0].conditions = [cond("Work of good quality is delivered")];
    expect(find(p, "VAGUE_CONDITION:0:0")!.severity).toBe("blocking");
  });

  it("V7 only warns when the milestone also has an objective condition", () => {
    const p = cleanProposed();
    p.milestones[0].conditions = [cond("A report of 10 pages is delivered"), cond("Revisions as needed")];
    expect(find(p, "VAGUE_CONDITION:0:0")!.severity).toBe("warning");
  });

  it.each(["satisfactory", "good quality", "reasonable", "as needed", "ASAP", "as soon as possible", "appropriate", "timely"])(
    "V7 detects the vague word %j",
    (word) => {
      const p = cleanProposed();
      p.milestones[0].conditions.push(cond(`Delivered ${word}`));
      expect(ids(p)).toContain("VAGUE_CONDITION:0:0");
    },
  );

  it("V7 flags subjective approval as a warning", () => {
    const p = cleanProposed();
    p.milestones[0].conditions.push(cond("Approved to the mentor's satisfaction"));
    expect(find(p, "SUBJECTIVE_APPROVAL:0:0")!.severity).toBe("warning");
  });

  it("recomputes `objective` from the lexicon: a model's claim that a vague condition is objective is ignored", () => {
    const p = cleanProposed();
    p.milestones[0].conditions = [{ text: "Delivered to a high quality standard", objective: true }];
    expect(find(p, "VAGUE_CONDITION:0:0")!.severity).toBe("blocking");
  });
});

describe("validator V8: conditional amounts", () => {
  it.each(["the remaining funds", "the balance of the fee", "a bonus of 0.5 ETH", "10% of the total", "0.5 ETH extra if delivered early"])(
    "flags %j as blocking CONDITIONAL_AMOUNT",
    (text) => {
      const p = cleanProposed();
      p.milestones[1].conditions.push(cond(text));
      expect(find(p, "CONDITIONAL_AMOUNT:1:0")!.severity).toBe("blocking");
    },
  );

  it.each(["A live demo shows 3 detections at 80% confidence or more", "Test coverage of at least 95%", "Passes 9 of 10 tests (90% pass rate)"])(
    "does NOT treat a percentage that is not about money as a conditional amount: %j",
    (text) => {
      const p = cleanProposed();
      p.milestones[1].conditions.push(cond(text));
      expect(ids(p)).not.toContain("CONDITIONAL_AMOUNT:1:0");
    },
  );

  it.each(["pay 25% on completion", "Payment: 40%", "a 20% bonus", "30 percent of the fee"])("still flags a money percentage: %j", (text) => {
    const p = cleanProposed();
    p.milestones[1].conditions.push(cond(text));
    expect(ids(p)).toContain("CONDITIONAL_AMOUNT:1:0");
  });

  it("suppresses MISSING_AMOUNT when CONDITIONAL_AMOUNT already explains the missing figure", () => {
    const got = ids(krishiProposed(), SOURCE);
    expect(got).toContain("CONDITIONAL_AMOUNT:2:0");
    expect(got).not.toContain("MISSING_AMOUNT:2:0");
  });
});

describe("validator V9: automatic transitions", () => {
  it.each(["released automatically", "if no response in 7 days", "deemed approved", "if no reply", "auto-release"])("flags %j", (text) => {
    const p = cleanProposed();
    p.milestones[0].conditions.push(cond(`Payment is ${text}`));
    expect(find(p, "UNDEFINED_TRANSITION:0:0")!.severity).toBe("blocking");
  });

  it("flags an automatic clause in the source that no milestone captured, at agreement level", () => {
    const src = CLEAN_SOURCE + "\nAll payments are released automatically after 7 days.\n";
    expect(ids(cleanProposed(), src)).toContain("UNDEFINED_TRANSITION:agreement:0");
  });
});

describe("validator V10: grounding", () => {
  it("flags an amount that does not appear in the text as AMOUNT_NOT_IN_TEXT (hallucination guard)", () => {
    const p = cleanProposed();
    p.totalStated = null;
    p.milestones[1].amount = "100";
    const a = find(p, "AMOUNT_NOT_IN_TEXT:1:0")!;
    expect(a.severity).toBe("blocking");
  });

  it("a plain '20' (as in '20 tests') does NOT ground a 20 ETH amount: only '<n> ETH' figures count", () => {
    const p = cleanProposed();
    p.totalStated = null;
    p.milestones[1].amount = "20";
    expect(ids(p)).toContain("AMOUNT_NOT_IN_TEXT:1:0");
  });

  it("grounds '2.5' against '2.50 eth' and 'test ETH' spellings", () => {
    expect([...ethAmountsInText("pay 2.50 eth now, plus 1 test ETH and 3,000 ETH")]).toEqual([
      2_500_000_000_000_000_000n,
      10n ** 18n,
      3_000n * 10n ** 18n,
    ]);
  });

  it("removes a quote that is not in the source and notes it; keeps real quotes (curly quotes, case, whitespace tolerant)", () => {
    const p = cleanProposed();
    p.parties.client.quote = "Client:   a co";
    p.parties.provider.quote = "Provider: invented person";
    p.milestones[0].quote = null;
    const { proposed, notes } = sanitizeQuotes(p, CLEAN_SOURCE);
    expect(proposed.parties.client.quote).toBe("Client:   a co");
    expect(proposed.parties.provider.quote).toBeNull();
    expect(notes).toHaveLength(1);
    const curly = sanitizeQuotes({ ...p, parties: { ...p.parties, client: { name: "x", quote: "Mentor’s “quote” — here" } } }, "the mentor's \"quote\" - here");
    expect(curly.proposed.parties.client.quote).not.toBeNull();
  });

  it("edited mode skips grounding: a human-typed amount that is not in the source is fine", () => {
    const p = cleanProposed();
    p.totalStated = "101";
    p.milestones[0].amount = "100";
    expect(ids(p, CLEAN_SOURCE, "edited")).not.toContain("AMOUNT_NOT_IN_TEXT:0:0");
  });
});

describe("validator V11 and CURRENCY_UNCLEAR", () => {
  it("V11 flags a missing or non-ISO deadline as a warning", () => {
    const p = cleanProposed();
    p.milestones[0].deadline = null;
    p.milestones[1].deadline = "15 Nov";
    const r = validate(p, CLEAN_SOURCE).ambiguities;
    expect(r.find((a) => a.id === "MISSING_DEADLINE:0:0")!.severity).toBe("warning");
    expect(r.find((a) => a.id === "MISSING_DEADLINE:1:0")).toBeDefined();
  });

  it.each(["₹50,000 or equivalent", "Rs. 5000", "INR 40000", "$100", "100 USD"])("flags the source text %j as CURRENCY_UNCLEAR", (txt) => {
    expect(ids(cleanProposed(), `${CLEAN_SOURCE}\nFee: ${txt}`)).toContain("CURRENCY_UNCLEAR:agreement:0");
  });

  it("flags a non-ETH currency field", () => {
    const p = cleanProposed();
    p.currency = "INR";
    expect(find(p, "CURRENCY_UNCLEAR:agreement:0")!.severity).toBe("blocking");
  });
});

describe("validator: ids and modes", () => {
  it("ids are stable and de-duplicated: one ambiguity per (type, milestoneIndex)", () => {
    const p = cleanProposed();
    p.milestones[0].conditions = [cond("good quality"), cond("as needed"), cond("reasonable")];
    const all = validate(p, CLEAN_SOURCE).ambiguities.filter((a) => a.type === "VAGUE_CONDITION");
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("VAGUE_CONDITION:0:0");
  });

  it("edited mode ignores source quotes: a removed clause no longer raises UNDEFINED_TRANSITION", () => {
    const p = cleanProposed();
    p.milestones[0].quote = "Payment is released automatically.";
    expect(ids(p, CLEAN_SOURCE, "proposal")).toContain("UNDEFINED_TRANSITION:0:0");
    expect(ids(p, CLEAN_SOURCE, "edited")).not.toContain("UNDEFINED_TRANSITION:0:0");
  });
});

describe("LLM JSON schema stays in sync with the zod schema", () => {
  it("has the same top-level, milestone, condition and ambiguity keys", () => {
    const zodTop = Object.keys(llmChecklistSchema.shape).sort();
    expect(Object.keys(llmChecklistJsonSchema.properties).sort()).toEqual(zodTop);
    expect([...llmChecklistJsonSchema.required].sort()).toEqual(zodTop);
    const ms = llmChecklistJsonSchema.properties.milestones.items;
    expect(Object.keys(ms.properties).sort()).toEqual(["amount", "conditions", "deadline", "deliverableType", "index", "quote", "title"]);
    expect([...ms.required].sort()).toEqual(Object.keys(ms.properties).sort());
    const amb = llmChecklistJsonSchema.properties.ambiguities.items;
    expect(Object.keys(amb.properties).sort()).toEqual(["message", "milestoneIndex", "question", "quote", "suggestedResolutions", "type"]);
    const sample = llmChecklistSchema.shape.milestones.element.shape;
    expect(Object.keys(sample).sort()).toEqual(Object.keys(ms.properties).sort());
    expect(Object.keys(llmChecklistSchema.shape.ambiguities.element.shape).sort()).toEqual(Object.keys(amb.properties).sort());
  });
});
