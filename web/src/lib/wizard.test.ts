import { describe, expect, it } from "vitest";
import { checkGate, extractWithRules, mergeAmbiguities, normalizeProposed, sanitizeQuotes, validate, type Ambiguity, type ProposedChecklist } from "@mv/shared";
import { applyEdits, fixesFor, gateReasons, initialState, reducer, summarizeGate, type WizardAction, type WizardState } from "./wizard";
import { buildSegments, findQuote, locateAnchors } from "./highlight";

const SOURCE = `Client: Campus Incubation Cell
Provider: KrishiLens student team
Arbiter: Prof. Anita Verma (faculty mentor)
Total: 5 ETH

Milestone 1 - Problem validation report. The Team delivers a written report of at least 8 pages. Due 31 October 2026. Payment: 1 ETH.

Milestone 2 - Working prototype. The Team delivers a working prototype, identified by a git commit hash. The prototype must be approved to the mentor's satisfaction. Due 15 December 2026. Payment: 2.5 ETH. The Team will receive 0.5 ETH extra if this prototype is delivered before 30 Nov.

Milestone 3 - Pilot with farmers. The Team runs a pilot with 20 farmers and delivers a pilot report. Payment: the remaining funds after Milestone 1 and Milestone 2.
`;

const proposal = (): ProposedChecklist => sanitizeQuotes(normalizeProposed(extractWithRules(SOURCE)), SOURCE).proposed;
const flags = (p: ProposedChecklist): Ambiguity[] => mergeAmbiguities(p.ambiguities, validate(p, SOURCE, "proposal").ambiguities);
const byId = (list: Ambiguity[], id: string): Ambiguity => list.find((a) => a.id === id)!;
const ADDR = { client: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", provider: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", arbiter: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" };

describe("applyEdit", () => {
  it("never mutates the original proposal", () => {
    const p = proposal();
    const before = JSON.stringify(p);
    applyEdits(p, [{ type: "amount", i: 2, value: "1.5" }, { type: "total", value: "6" }, { type: "removeCondition", i: 1, j: 0 }]);
    expect(JSON.stringify(p)).toBe(before);
  });

  it("recomputes the objective flag when a condition text is edited", () => {
    const edited = applyEdits(proposal(), [{ type: "condition", i: 0, j: 0, text: "Delivered to a good quality standard" }]);
    expect(edited.milestones[0].conditions[0].objective).toBe(false);
    const fixed = applyEdits(edited, [{ type: "condition", i: 0, j: 0, text: "A report of 8 pages is delivered" }]);
    expect(fixed.milestones[0].conditions[0].objective).toBe(true);
  });
});

describe("typed one-click fixes", () => {
  const p = proposal();
  const list = flags(p);

  it("offers the remaining amount for 'the remaining funds' computed from the total (5 - 1 - 2.5 = 1.5)", () => {
    const fix = fixesFor(byId(list, "CONDITIONAL_AMOUNT:2:0"), p)[0];
    expect(fix.label).toContain("1.5 ETH");
    expect(fix.action).toBe("edited");
    expect(applyEdits(p, fix.edits).milestones[2].amount).toBe("1.5");
  });

  it("offers 'Remove the conditional clause' (clause-removed) for the bonus, which keeps the fixed amount", () => {
    const fix = fixesFor(byId(list, "CONDITIONAL_AMOUNT:1:0"), p).find((f) => f.action === "clause-removed")!;
    expect(fix).toBeDefined();
    expect(applyEdits(p, fix.edits).milestones[1].amount).toBe("2.5");
  });

  it("replaces the subjective condition with an objective test", () => {
    const fix = fixesFor(byId(list, "SUBJECTIVE_APPROVAL:1:0"), p).find((f) => f.label.startsWith("Replace with: A live demo"))!;
    const edited = applyEdits(p, fix.edits);
    expect(edited.milestones[1].conditions.map((c) => c.text)).not.toContain("The prototype must be approved to the mentor's satisfaction");
    expect(edited.milestones[1].conditions.at(-1)!.objective).toBe(true);
  });

  it("does not add a replacement condition the milestone already has (two flags can offer the same fix)", () => {
    const fix = fixesFor(byId(list, "SUBJECTIVE_APPROVAL:1:0"), p).find((f) => f.label.startsWith("Replace with: A live demo"))!;
    const once = applyEdits(p, fix.edits);
    const vague: Ambiguity = { ...byId(list, "SUBJECTIVE_APPROVAL:1:0"), id: "VAGUE_CONDITION:1:0", type: "VAGUE_CONDITION" };
    const again = fixesFor(vague, once).find((f) => f.label.startsWith("Replace with: A live demo"))!;
    expect(applyEdits(once, again.edits).milestones[1].conditions).toHaveLength(once.milestones[1].conditions.length);
  });

  it("does not offer a total fix for the mismatch until every milestone has an amount, then offers the exact sum", () => {
    expect(fixesFor(byId(list, "AMOUNT_MISMATCH:agreement:0"), p)).toEqual([]);
    const withAmount = applyEdits(p, [{ type: "amount", i: 2, value: "1.5" }]);
    const fix = fixesFor(byId(list, "AMOUNT_MISMATCH:agreement:0"), withAmount)[0];
    expect(fix.label).toBe("Set the total to 5 ETH");
  });

  it("offers an acknowledge fix for warnings only, never for a blocking issue", () => {
    expect(fixesFor(byId(list, "MISSING_DEADLINE:2:0"), p).map((f) => f.action)).toEqual(["acknowledged"]);
    for (const a of list.filter((x) => x.severity === "blocking")) {
      expect(fixesFor(a, p).some((f) => f.action === "acknowledged")).toBe(false);
    }
  });

  it("an objective template never trips the lexicon it is meant to satisfy ('80% confidence' is not a money percentage)", () => {
    const fix = fixesFor(byId(list, "SUBJECTIVE_APPROVAL:1:0"), p)[0];
    const edited = applyEdits(p, fix.edits);
    expect(validate(edited, SOURCE, "edited").ambiguities.map((a) => a.id)).not.toContain("CONDITIONAL_AMOUNT:1:0");
    expect(validate(edited, SOURCE, "edited").ambiguities.map((a) => a.id)).not.toContain("SUBJECTIVE_APPROVAL:1:0");
  });

  it("offers a way out of an AI false positive: remove the clause with the note 'No such clause in the agreement.'", () => {
    const fake: Ambiguity = { id: "UNDEFINED_TRANSITION:2:0", origin: "ai", type: "UNDEFINED_TRANSITION", severity: "blocking", milestoneIndex: 2, quote: null, message: "m", question: "q", suggestedResolutions: [] };
    const fix = fixesFor(fake, p).find((f) => f.action === "clause-removed")!;
    expect(fix.note).toBe("No such clause in the agreement.");
    expect(fix.edits).toEqual([]);
  });
});

describe("summarizeGate", () => {
  const input = (edited: ProposedChecklist, resolutions: WizardState["resolutions"] = {}) => ({
    proposed: proposal(),
    edited,
    sourceText: SOURCE,
    resolutions: Object.values(resolutions),
    addresses: ADDR,
    reviewWindowSeconds: 120,
    extraction: { source: "rules" as const, model: null },
    confirmedAt: "1970-01-01T00:00:00.000Z",
  });

  it("counts open blocking issues and warnings without repeating the same cause as raw ids", () => {
    const g = summarizeGate(checkGate(input(proposal())));
    expect(g.blockingOpen).toBe(3);
    expect(g.warningOpen).toBe(2);
    const reasons = gateReasons(g, true);
    expect(reasons).toEqual(["Confirm is locked: 3 blocking issues are still open", "2 warnings still need a decision"]);
    expect(reasons.join(" ")).not.toMatch(/[A-Z_]+:\d:0/);
  });

  it("explains 'still blocked' only for issues the user already marked resolved", () => {
    const res = { "AMOUNT_MISMATCH:agreement:0": { ambiguityId: "AMOUNT_MISMATCH:agreement:0", action: "edited" as const, note: "claimed fixed", resolvedBy: "client" as const } };
    const g = summarizeGate(checkGate(input(proposal(), res)), new Set(Object.keys(res)));
    expect(g.stillBlocked.join(" ")).toMatch(/Still blocked after your edit: The milestones add up to 3.5 ETH/);
  });

  it("separates wallet and review-window problems (step 4) from ambiguity problems (step 3)", () => {
    const i = input(proposal());
    i.addresses = { ...ADDR, arbiter: ADDR.client };
    const g = summarizeGate(checkGate(i));
    expect(g.setup.join(" ")).toMatch(/three different wallet addresses/);
    expect(gateReasons(g, false).join(" ")).not.toMatch(/wallet/);
  });
});

describe("wizard reducer", () => {
  const extraction = (): NonNullable<WizardState["extraction"]> => ({
    proposed: proposal(),
    notes: [],
    hardErrors: [],
    meta: { requestedMode: "rules", source: "rules", model: null, latencyMs: 1, fallbackReason: null, truncated: false },
  });
  const started = (): WizardState => reducer(initialState(ADDR), { type: "extracted", text: SOURCE, extraction: extraction() });

  it("extraction starts a fresh run at the Proposal step with a deep clone to edit", () => {
    const s = started();
    expect(s.step).toBe(2);
    expect(s.edited).toEqual(s.extraction!.proposed);
    expect(s.edited).not.toBe(s.extraction!.proposed);
  });

  it("an edit changes only `edited` (the proposal stays exactly as the AI sent it) and clears a confirmed seal", () => {
    let s = started();
    const original = JSON.stringify(s.extraction!.proposed);
    s = { ...s, confirmed: { checklist: {} as never, hash: "0x1", canonical: "", storedOnServer: true } };
    s = reducer(s, { type: "edit", edits: [{ type: "amount", i: 2, value: "1.5" }] });
    expect(s.edited!.milestones[2].amount).toBe("1.5");
    expect(JSON.stringify(s.extraction!.proposed)).toBe(original);
    expect(s.confirmed).toBeNull();
  });

  it("resolving or changing wallets or the window also clears the seal", () => {
    const withSeal = (s: WizardState): WizardState => ({ ...s, confirmed: { checklist: {} as never, hash: "0x1", canonical: "", storedOnServer: true } });
    expect(reducer(withSeal(started()), { type: "window", seconds: 60 }).confirmed).toBeNull();
    expect(reducer(withSeal(started()), { type: "address", role: "client", address: ADDR.provider }).confirmed).toBeNull();
    expect(reducer(withSeal(started()), { type: "unresolve", id: "x" }).confirmed).toBeNull();
  });

  it("after deployment the terms are locked: edits, resolutions, wallets and extraction are ignored until 'Start over'", () => {
    let s = reducer(started(), { type: "deployed", address: "0x" + "1".repeat(40), txHash: "0x2" });
    expect(s.step).toBe(6);
    const frozen = JSON.stringify(s);
    const attempts: WizardAction[] = [
      { type: "edit", edits: [{ type: "amount", i: 0, value: "9" }] },
      { type: "resolve", resolution: { ambiguityId: "x", action: "edited", note: "12345", resolvedBy: "client" } },
      { type: "address", role: "client", address: ADDR.arbiter },
      { type: "window", seconds: 5 },
      { type: "text", text: "other" },
      { type: "extracted", text: "other", extraction: extraction() },
    ];
    for (const a of attempts) s = reducer(s, a);
    expect(JSON.stringify(s)).toBe(frozen);
    expect(reducer(s, { type: "reset" }).deployed).toBeNull();
  });
});

describe("highlighting", () => {
  it("finds quotes case-insensitively and across curly quotes and line breaks", () => {
    expect(findQuote("To the Mentor’s\nsatisfaction.", "to the mentor's satisfaction")).toEqual([0, 28]);
    expect(findQuote("abc", "xyz")).toBeNull();
  });

  it("searches a quote inside its own milestone's paragraph, not the first match anywhere", () => {
    const p = proposal();
    const list = flags(p);
    const a = byId(list, "CONDITIONAL_AMOUNT:2:0");
    const anchors = locateAnchors(SOURCE, [{ id: a.id, quote: a.quote, milestoneIndex: a.milestoneIndex }], p.milestones.map((m) => m.quote));
    const [start, end] = anchors.get(a.id)!;
    expect(SOURCE.slice(start, end).toLowerCase()).toBe("remaining");
    expect(start).toBeGreaterThan(SOURCE.indexOf("Milestone 3"));
  });

  it("anchors the bare-'5' total mismatch to the Total line, and a quote-less deadline flag to the milestone's title", () => {
    const p = proposal();
    const list = flags(p);
    const anchors = locateAnchors(
      SOURCE,
      list.map((a) => ({ id: a.id, quote: a.quote, milestoneIndex: a.milestoneIndex })),
      p.milestones.map((m) => m.quote),
    );
    const [ts, te] = anchors.get("AMOUNT_MISMATCH:agreement:0")!;
    expect(SOURCE.slice(ts, te)).toBe("Total: 5 ETH");
    const [ds] = anchors.get("MISSING_DEADLINE:2:0")!;
    expect(ds).toBe(SOURCE.indexOf("Pilot with farmers"));
  });

  it("buildSegments keeps all text, in order, and drops overlapping spans", () => {
    const anchors = new Map<string, [number, number]>([["a", [0, 5]], ["b", [3, 8]], ["c", [10, 12]]]);
    const segs = buildSegments("0123456789abcdef", anchors);
    expect(segs.map((s) => s.text).join("")).toBe("0123456789abcdef");
    expect(segs.filter((s) => s.id).map((s) => s.id)).toEqual(["a", "c"]);
  });
});
