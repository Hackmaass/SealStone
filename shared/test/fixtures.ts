import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatEther } from "ethers";
import { isObjectiveCondition, normalizeSourceText } from "../src/index";
import type { GateInput, ProposedChecklist, Resolution } from "../src/index";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

export const SOURCE = normalizeSourceText(read("../../samples/agreements/krishilens.txt"));
export const SAMPLE = JSON.parse(read("../../samples/krishilens.confirmed.json"));

export const cond = (text: string) => ({ text, objective: isObjectiveCondition(text) });

/** Slice a paragraph out of the sample text so quotes are real substrings. */
const para = (startsWith: string): string => {
  const start = SOURCE.indexOf(startsWith);
  const end = SOURCE.indexOf("\n\n", start);
  return SOURCE.slice(start, end === -1 ? undefined : end).trim();
};

const NO_QUOTE_PARTY = { name: null, quote: null };

/** A small, clean agreement that must produce ZERO ambiguities (measures false alarms). */
export const CLEAN_SOURCE = normalizeSourceText(`Client: A Co
Provider: B Co
Arbiter: C Person
Total: 3 ETH

Milestone 1 - Report. B Co delivers a report of at least 10 pages. Due 2026-12-01. Payment: 1 ETH.

Milestone 2 - Prototype. B Co delivers a git commit hash that passes 20 tests. Due 2026-12-20. Payment: 2 ETH.
`);

export function cleanProposed(): ProposedChecklist {
  return {
    schemaVersion: 1,
    source: "rules",
    title: "Clean agreement",
    parties: {
      client: { name: "A Co", quote: "Client: A Co" },
      provider: { name: "B Co", quote: "Provider: B Co" },
      arbiter: { name: "C Person", quote: "Arbiter: C Person" },
    },
    currency: "ETH",
    totalStated: "3",
    milestones: [
      {
        index: 0,
        title: "Report",
        amount: "1",
        conditions: [cond("B Co delivers a report of at least 10 pages")],
        deadline: "2026-12-01",
        deliverableType: "document",
        quote: "Milestone 1 - Report. B Co delivers a report of at least 10 pages. Due 2026-12-01. Payment: 1 ETH.",
      },
      {
        index: 1,
        title: "Prototype",
        amount: "2",
        conditions: [cond("B Co delivers a git commit hash that passes 20 tests")],
        deadline: "2026-12-20",
        deliverableType: "code",
        quote: "Milestone 2 - Prototype. B Co delivers a git commit hash that passes 20 tests. Due 2026-12-20. Payment: 2 ETH.",
      },
    ],
    ambiguities: [],
    confidence: 0.9,
  };
}

export function emptyPartiesProposed(): ProposedChecklist {
  return { ...cleanProposed(), parties: { client: NO_QUOTE_PARTY, provider: NO_QUOTE_PARTY, arbiter: NO_QUOTE_PARTY } };
}

/** The KrishiLens proposal exactly as the rules extractor produces it (amounts/dates as written). */
export function krishiProposed(): ProposedChecklist {
  return {
    schemaVersion: 1,
    source: "rules",
    title: "KRISHILENS INCUBATION GRANT AGREEMENT",
    parties: {
      client: { name: "Campus Incubation Cell", quote: "Client: Campus Incubation Cell" },
      provider: { name: "KrishiLens student team", quote: "Provider: KrishiLens student team" },
      arbiter: { name: "Prof. Anita Verma (faculty mentor)", quote: "Arbiter: Prof. Anita Verma (faculty mentor)" },
    },
    currency: "ETH",
    totalStated: "5",
    milestones: [
      {
        index: 0,
        title: "Problem validation report",
        amount: "1",
        conditions: [cond("The Team delivers a written report of at least 8 pages covering interviews with at least 10 farmers and a ranking of the five most common crop diseases in the pilot region")],
        deadline: "2026-10-31",
        deliverableType: "document",
        quote: para("Milestone 1"),
      },
      {
        index: 1,
        title: "Working prototype",
        amount: "2.5",
        conditions: [
          cond("The Team delivers a working prototype of the app, identified by a git commit hash, that classifies photos of at least three crop diseases"),
          cond("The prototype must be approved to the mentor's satisfaction"),
        ],
        deadline: "2026-12-15",
        deliverableType: "code",
        quote: para("Milestone 2"),
      },
      {
        index: 2,
        title: "Pilot with farmers",
        amount: null,
        conditions: [cond("The Team runs a pilot with 20 farmers and delivers a pilot report with the usage results")],
        deadline: null,
        deliverableType: "document",
        quote: para("Milestone 3"),
      },
    ],
    ambiguities: [],
    confidence: 0.5,
  };
}

/** The same agreement after the human fixed every flag (values taken from samples/krishilens.confirmed.json). */
export function krishiEdited(): ProposedChecklist {
  return {
    ...krishiProposed(),
    title: SAMPLE.title,
    milestones: SAMPLE.milestones.map((m: any, i: number) => ({
      index: i,
      title: m.title,
      amount: formatEther(BigInt(m.amountWei)),
      conditions: m.conditions.map(cond),
      deadline: m.deadline,
      deliverableType: m.deliverableType,
      quote: null,
    })),
  };
}

export function krishiGateInput(over: Partial<GateInput> = {}): GateInput {
  return {
    proposed: krishiProposed(),
    edited: krishiEdited(),
    sourceText: SOURCE,
    resolutions: SAMPLE.resolutions as Resolution[],
    addresses: {
      client: SAMPLE.parties.client.address,
      provider: SAMPLE.parties.provider.address,
      arbiter: SAMPLE.parties.arbiter.address,
    },
    reviewWindowSeconds: SAMPLE.reviewWindowSeconds,
    extraction: { source: "rules", model: null },
    confirmedAt: SAMPLE.confirmedAt,
    ...over,
  };
}
