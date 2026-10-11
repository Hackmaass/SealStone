import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  agreementHash,
  assertConfirmable,
  mergeAmbiguities,
  normalizeProposed,
  normalizeSourceText,
  sanitizeQuotes,
  validate,
} from "@mv/shared";
import { extractWithRules } from "../src/ai/rules";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SOURCE = normalizeSourceText(read("../../samples/agreements/krishilens.txt"));
const SAMPLE = JSON.parse(read("../../samples/krishilens.confirmed.json"));

const pipeline = (text: string) => {
  const proposed = normalizeProposed(extractWithRules(text));
  const sanitized = sanitizeQuotes(proposed, text);
  const checked = validate(sanitized.proposed, text, "proposal");
  return { proposed: sanitized.proposed, merged: mergeAmbiguities(sanitized.proposed.ambiguities, checked.ambiguities), checked, notes: sanitized.notes };
};

describe("rules extractor on krishilens.txt", () => {
  const { proposed, merged, checked, notes } = pipeline(SOURCE);

  it("finds the three parties, the stated total and the currency", () => {
    expect(proposed.parties.client.name).toBe("Campus Incubation Cell");
    expect(proposed.parties.provider.name).toBe("KrishiLens student team");
    expect(proposed.parties.arbiter.name).toBe("Prof. Anita Verma (faculty mentor)");
    expect(proposed.totalStated).toBe("5");
    expect(proposed.currency).toBe("ETH");
    expect(proposed.source).toBe("rules");
  });

  it("finds all 3 milestones with their amounts as written (M3 is 'the remaining funds', so null)", () => {
    expect(proposed.milestones).toHaveLength(3);
    expect(proposed.milestones.map((m) => m.title)).toEqual(["Problem validation report", "Working prototype", "Pilot with farmers"]);
    expect(proposed.milestones.map((m) => m.amount)).toEqual(["1", "2.5", null]);
  });

  it("takes the 'Due' date with a year and ignores the year-less '30 Nov' bonus date", () => {
    expect(proposed.milestones.map((m) => m.deadline)).toEqual(["2026-10-31", "2026-12-15", null]);
  });

  it("classifies deliverables and splits sentences into conditions without the Due/Payment/bonus sentences", () => {
    expect(proposed.milestones.map((m) => m.deliverableType)).toEqual(["document", "code", "document"]);
    expect(proposed.milestones[1].conditions.map((c) => c.text.slice(0, 30))).toEqual([
      "The Team delivers a working pr",
      "The prototype must be approved",
    ]);
    expect(proposed.milestones[1].conditions.map((c) => c.objective)).toEqual([true, false]);
  });

  it("every quote is a real substring of the text (nothing is removed by grounding)", () => {
    expect(notes).toEqual([]);
    expect(checked.hardErrors).toEqual([]);
  });

  it("raises AMOUNT_MISMATCH, CONDITIONAL_AMOUNT, SUBJECTIVE_APPROVAL and MISSING_DEADLINE", () => {
    const got = merged.map((a) => a.id);
    expect(got).toContain("AMOUNT_MISMATCH:agreement:0");
    expect(got).toContain("CONDITIONAL_AMOUNT:1:0"); // the 0.5 ETH early bonus
    expect(got).toContain("CONDITIONAL_AMOUNT:2:0"); // "the remaining funds"
    expect(got).toContain("SUBJECTIVE_APPROVAL:1:0");
    expect(got).toContain("MISSING_DEADLINE:2:0");
  });

  it("CONSISTENCY: the merged ambiguity ids are exactly the ids resolved in the pre-seeded sample", () => {
    expect(merged.map((a) => a.id).sort()).toEqual(SAMPLE.resolutions.map((r: { ambiguityId: string }) => r.ambiguityId).sort());
  });

  it("CONSISTENCY: extractor output + the sample's edits + its resolutions confirm to the SAME agreementHash as the sample", () => {
    const edited = {
      ...proposed,
      title: SAMPLE.title,
      milestones: SAMPLE.milestones.map((m: any, i: number) => ({
        index: i,
        title: m.title,
        amount: String(Number(BigInt(m.amountWei) / 10n ** 15n) / 1000),
        conditions: m.conditions.map((text: string) => ({ text, objective: true })),
        deadline: m.deadline,
        deliverableType: m.deliverableType,
        quote: null,
      })),
    };
    const confirmed = assertConfirmable({
      proposed,
      edited,
      sourceText: SOURCE,
      resolutions: SAMPLE.resolutions,
      addresses: { client: SAMPLE.parties.client.address, provider: SAMPLE.parties.provider.address, arbiter: SAMPLE.parties.arbiter.address },
      reviewWindowSeconds: SAMPLE.reviewWindowSeconds,
      extraction: { source: "rules", model: null },
      confirmedAt: SAMPLE.confirmedAt,
    });
    expect(agreementHash(confirmed)).toBe(agreementHash(SAMPLE));
  });
});

describe("rules extractor: format variants", () => {
  it("reads 'Funder:', 'Mentor (arbiter):' and treats 'TBD' as no name", () => {
    const text = "Funder: Acme Fund\nContractor: Bolt Labs\nMentor (arbiter): Dr. Rao\n";
    const p = extractWithRules(text);
    expect(p.parties.client.name).toBe("Acme Fund");
    expect(p.parties.provider.name).toBe("Bolt Labs");
    expect(p.parties.arbiter.name).toBe("Dr. Rao");
    const none = extractWithRules("Client: A\nProvider: B\nArbiter: TBD\n");
    expect(none.parties.arbiter.name).toBeNull();
    expect(pipeline("Client: A\nProvider: B\nArbiter: TBD\n").merged.map((a) => a.id)).toContain("MISSING_PARTY:agreement:0");
  });

  it("reads 'M1' headings, bullet conditions, 'Amount:' lines and '15 Nov 2026' dates", () => {
    const text = `Client: A\nProvider: B\nArbiter: C\nTotal: 2.5 ETH\n\nM1 - Landing page\n- Page has 5 sections\n- Passes 10 checks\nAmount: 1.5 ETH\nDeadline: 15 Nov 2026\n\nM2 - Backend\n- API has 4 endpoints\nAmount: 1 ETH\nDue by November 30, 2026\n`;
    const p = extractWithRules(text);
    expect(p.milestones).toHaveLength(2);
    expect(p.milestones[0]).toMatchObject({ title: "Landing page", amount: "1.5", deadline: "2026-11-15" });
    expect(p.milestones[0].conditions.map((c) => c.text)).toEqual(["Page has 5 sections", "Passes 10 checks"]);
    expect(p.milestones[1]).toMatchObject({ amount: "1", deadline: "2026-11-30" });
    expect(pipeline(text).merged.filter((a) => a.severity === "blocking")).toEqual([]);
  });

  it("parses the prose total 'a total of N ETH' when there is no Total: line", () => {
    expect(extractWithRules("The fee is a total of 7.5 ETH in two parts.").totalStated).toBe("7.5");
  });

  it("returns a valid empty proposal (no crash) for text with no structure", () => {
    const { merged, checked } = pipeline("Hello there, this is not an agreement.");
    expect(checked.hardErrors).toHaveLength(1);
    expect(merged.map((a) => a.id)).toContain("MISSING_PARTY:agreement:0");
  });

  it("an automatic-release clause is flagged UNDEFINED_TRANSITION", () => {
    const text = "Client: A\nProvider: B\nArbiter: C\n\nMilestone 1 - Shed base. Pour a slab of 4 by 5 metres. Due 2026-11-01. Payment: 1 ETH. If no response in 7 days payment is released automatically.\n";
    expect(pipeline(text).merged.map((a) => a.id)).toContain("UNDEFINED_TRANSITION:0:0");
  });
});
