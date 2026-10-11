import { formatEther } from "ethers";
import {
  AUTO_TRANSITION_PATTERNS,
  CONDITIONAL_AMOUNT_PATTERNS,
  firstMatch,
  isObjectiveCondition,
  isSubjective,
  isVague,
  parseAmountWei,
  type Ambiguity,
  type ConfirmedChecklist,
  type GateReport,
  type ProposedChecklist,
  type Resolution,
  type Role,
} from "@mv/shared";
import type { ExtractResponse } from "./api";

// ───────────────────────────── Editing the checklist ─────────────────────────────

export type Edit =
  | { type: "amount"; i: number; value: string | null }
  | { type: "total"; value: string | null }
  | { type: "condition"; i: number; j: number; text: string }
  | { type: "removeCondition"; i: number; j: number }
  | { type: "addCondition"; i: number; text: string }
  | { type: "deadline"; i: number; value: string | null }
  | { type: "party"; role: Role; name: string }
  | { type: "currency"; value: string };

const cond = (text: string) => ({ text, objective: isObjectiveCondition(text) });

/** Pure edit of a proposed checklist. The original `proposed` is never touched. */
export function applyEdit(c: ProposedChecklist, e: Edit): ProposedChecklist {
  const ms = c.milestones.map((m) => ({ ...m, conditions: [...m.conditions] }));
  switch (e.type) {
    case "amount":
      ms[e.i].amount = e.value === "" ? null : e.value;
      return { ...c, milestones: ms };
    case "total":
      return { ...c, totalStated: e.value === "" ? null : e.value };
    case "condition":
      ms[e.i].conditions[e.j] = cond(e.text);
      return { ...c, milestones: ms };
    case "removeCondition":
      ms[e.i].conditions.splice(e.j, 1);
      return { ...c, milestones: ms };
    case "addCondition":
      ms[e.i].conditions.push(cond(e.text));
      return { ...c, milestones: ms };
    case "deadline":
      ms[e.i].deadline = e.value === "" ? null : e.value;
      return { ...c, milestones: ms };
    case "party":
      return { ...c, parties: { ...c.parties, [e.role]: { ...c.parties[e.role], name: e.name === "" ? null : e.name } } };
    case "currency":
      return { ...c, currency: e.value };
  }
}

export const applyEdits = (c: ProposedChecklist, edits: Edit[]): ProposedChecklist => edits.reduce(applyEdit, c);

// ───────────────────────────── One-click fixes (typed, rules-derived) ─────────────────────────────

export interface Fix {
  label: string;
  action: Resolution["action"];
  note: string;
  edits: Edit[];
}

const ethString = (wei: bigint): string => formatEther(wei).replace(/\.0$/, "");

const OBJECTIVE_TEMPLATES = [
  "A live demo shows 3 detections at 80% confidence or more",
  "The deliverable passes an agreed test of 10 checks with at most 2 failures",
];

const matchingIndexes = (texts: string[], test: (t: string) => boolean): number[] => texts.flatMap((t, j) => (test(t) ? [j] : []));

/** Removal edits must go from the highest index down so earlier indexes stay valid. */
const removals = (i: number, js: number[]): Edit[] => [...js].sort((a, b) => b - a).map((j) => ({ type: "removeCondition", i, j }));

export function fixesFor(a: Ambiguity, edited: ProposedChecklist): Fix[] {
  const i = a.milestoneIndex;
  const m = i !== null ? edited.milestones[i] : undefined;
  const texts = m ? m.conditions.map((c) => c.text) : [];
  const fixes: Fix[] = [];

  switch (a.type) {
    case "MISSING_AMOUNT":
    case "CONDITIONAL_AMOUNT":
    case "AMOUNT_NOT_IN_TEXT": {
      if (i === null || !m) break;
      const total = parseAmountWei(edited.totalStated);
      const others = edited.milestones.reduce((s, x, k) => (k === i ? s : s + (parseAmountWei(x.amount) ?? 0n)), 0n);
      const hasFigure = parseAmountWei(m.amount) !== null && a.type !== "AMOUNT_NOT_IN_TEXT";
      const conditional = matchingIndexes(texts, (t) => firstMatch(t, CONDITIONAL_AMOUNT_PATTERNS) !== null);
      if (!hasFigure && total !== null && total > others) {
        const eth = ethString(total - others);
        fixes.push({
          label: `${eth} ETH (total ${ethString(total)} minus the other milestones)`,
          action: "edited",
          note: `Fixed at ${eth} ETH: the stated total minus the other milestones.`,
          edits: [{ type: "amount", i, value: eth }, ...removals(i, conditional)],
        });
      }
      if (a.type === "CONDITIONAL_AMOUNT" && hasFigure) {
        fixes.push({
          label: "Remove the conditional clause",
          action: "clause-removed",
          note: `Conditional clause removed by agreement; milestone ${i + 1} pays a fixed ${ethString(parseAmountWei(m.amount)!)} ETH.`,
          edits: removals(i, conditional),
        });
      }
      break;
    }
    case "AMOUNT_MISMATCH": {
      const wei = edited.milestones.map((x) => parseAmountWei(x.amount));
      if (wei.every((w): w is bigint => w !== null)) {
        const sum = wei.reduce((s, w) => s + w, 0n);
        fixes.push({
          label: `Set the total to ${ethString(sum)} ETH`,
          action: "edited",
          note: `Total corrected to ${ethString(sum)} ETH to match the milestones.`,
          edits: [{ type: "total", value: ethString(sum) }],
        });
      }
      break;
    }
    case "VAGUE_CONDITION":
    case "SUBJECTIVE_APPROVAL": {
      if (i === null || !m) break;
      const bad = matchingIndexes(texts, (t) => isVague(t) || isSubjective(t));
      for (const tpl of OBJECTIVE_TEMPLATES) {
        fixes.push({
          label: `Replace with: ${tpl}`,
          action: "edited",
          note: "Replaced a vague or subjective condition with an objective test.",
          // Never add a condition the milestone already has (two flags on one milestone can offer the same replacement).
          edits: bad.length > 0 ? [{ type: "condition", i, j: bad[0], text: tpl }, ...removals(i, bad.slice(1))] : texts.includes(tpl) ? [] : [{ type: "addCondition", i, text: tpl }],
        });
      }
      if (bad.length > 0 && texts.length > bad.length) {
        fixes.push({ label: "Remove this clause", action: "clause-removed", note: "Vague clause removed by agreement.", edits: removals(i, bad) });
      }
      if (a.severity === "warning") {
        fixes.push({ label: "Acknowledge: both parties accept this wording", action: "acknowledged", note: "Both parties accept this wording as is.", edits: [] });
      }
      break;
    }
    case "UNDEFINED_TRANSITION": {
      const bad = i !== null ? matchingIndexes(texts, (t) => firstMatch(t, AUTO_TRANSITION_PATTERNS) !== null) : [];
      fixes.push({
        label: "Remove this clause",
        action: "clause-removed",
        note: bad.length > 0 ? "Automatic-payment clause removed: the contract never pays automatically." : "No such clause in the agreement.",
        edits: i !== null ? removals(i, bad) : [],
      });
      if (i !== null && bad.length > 0) {
        fixes.push({
          label: "Use the review window instead",
          action: "edited",
          note: "Replaced with the review window: the provider may escalate to the arbiter.",
          edits: [{ type: "condition", i, j: bad[0], text: "If the client has not responded when the review window ends, the provider may escalate to the arbiter" }, ...removals(i, bad.slice(1))],
        });
      }
      break;
    }
    case "MISSING_DEADLINE":
      fixes.push({ label: "Acknowledge: no deadline by agreement", action: "acknowledged", note: "No deadline by mutual agreement.", edits: [] });
      break;
    case "CURRENCY_UNCLEAR":
      fixes.push({ label: "All amounts are in ETH", action: "edited", note: "Every amount is fixed in test ETH.", edits: [{ type: "currency", value: "ETH" }] });
      break;
    default:
      break;
  }
  return fixes;
}

// ───────────────────────────── Reading the gate report ─────────────────────────────

export interface GateSummary {
  blockingOpen: number;
  warningOpen: number;
  /** Edits that left something blocked, with the reason. */
  stillBlocked: string[];
  /** Step-4 issues: wallets, review window. */
  setup: string[];
  /** Anything else (missing amounts, names...). */
  other: string[];
  /** Nothing about ambiguities is left: the user may move on to the Confirm step. */
  ambiguitiesClear: boolean;
  ready: boolean;
}

export function summarizeGate(report: GateReport, resolvedIds: Set<string> = new Set()): GateSummary {
  const s: GateSummary = { blockingOpen: 0, warningOpen: 0, stillBlocked: [], setup: [], other: [], ambiguitiesClear: false, ready: report.errors.length === 0 };
  for (const e of report.errors) {
    const still = /^Still blocking after editing: (\S+?): (.*)$/.exec(e);
    if (/^Unresolved blocking ambiguity/.test(e) || /is blocking: it must be resolved/.test(e)) s.blockingOpen++;
    else if (/^Unresolved warning ambiguity/.test(e)) s.warningOpen++;
    else if (still) {
      // Only interesting once the user has marked it resolved: before that it is already counted as an open issue.
      if (resolvedIds.has(still[1])) s.stillBlocked.push(`Still blocked after your edit: ${still[2]}`);
    } else if (/wallet address|different wallet|review window/i.test(e)) s.setup.push(e);
    else s.other.push(e);
  }
  s.ambiguitiesClear = s.blockingOpen === 0 && s.warningOpen === 0 && s.stillBlocked.length === 0 && s.other.length === 0;
  return s;
}

/** The sticky bar's list of reasons, in plain words and without repeating the same cause twice. */
export function gateReasons(g: GateSummary, includeSetup: boolean): string[] {
  const out: string[] = [];
  if (g.blockingOpen) out.push(`Confirm is locked: ${g.blockingOpen} blocking ${g.blockingOpen === 1 ? "issue is" : "issues are"} still open`);
  if (g.warningOpen) out.push(`${g.warningOpen} ${g.warningOpen === 1 ? "warning still needs" : "warnings still need"} a decision`);
  out.push(...g.stillBlocked);
  if (!g.blockingOpen && !g.warningOpen) out.push(...g.other);
  if (includeSetup) out.push(...g.setup);
  return out;
}

// ───────────────────────────── Wizard state ─────────────────────────────

export type Step = 1 | 2 | 3 | 4 | 5 | 6;
export const STEP_NAMES = ["Paste", "Proposal", "Resolve", "Confirm", "Deploy", "Sign and fund"] as const;

export interface ConfirmedState {
  checklist: ConfirmedChecklist;
  hash: string;
  canonical: string;
  /** false when the server was offline and the confirmed JSON only exists in this browser. */
  storedOnServer: boolean;
}

export interface WizardState {
  step: Step;
  text: string;
  extraction: { proposed: ProposedChecklist; meta: ExtractResponse["meta"]; notes: string[]; hardErrors: string[] } | null;
  edited: ProposedChecklist | null;
  resolutions: Record<string, Resolution>;
  addresses: Record<Role, string>;
  reviewWindowSeconds: number;
  confirmed: ConfirmedState | null;
  deployed: { address: string; txHash: string } | null;
  signatures: { client: string | null; provider: string | null };
  funded: string | null;
}

export const emptyAddresses: Record<Role, string> = { client: "", provider: "", arbiter: "" };

export function initialState(addresses: Record<Role, string> = emptyAddresses): WizardState {
  return {
    step: 1,
    text: "",
    extraction: null,
    edited: null,
    resolutions: {},
    addresses,
    reviewWindowSeconds: 120,
    confirmed: null,
    deployed: null,
    signatures: { client: null, provider: null },
    funded: null,
  };
}

export type WizardAction =
  | { type: "text"; text: string }
  | { type: "extracted"; text: string; extraction: NonNullable<WizardState["extraction"]> }
  | { type: "edit"; edits: Edit[] }
  | { type: "resolve"; resolution: Resolution }
  | { type: "unresolve"; id: string }
  | { type: "address"; role: Role; address: string }
  | { type: "window"; seconds: number }
  | { type: "goto"; step: Step }
  | { type: "confirmed"; confirmed: ConfirmedState }
  | { type: "deployed"; address: string; txHash: string }
  | { type: "signed"; role: "client" | "provider"; txHash: string }
  | { type: "funded"; txHash: string }
  | { type: "reset"; addresses?: Record<Role, string> };

export function reducer(state: WizardState, a: WizardAction): WizardState {
  // After the vault is deployed the terms are locked: only the later steps (and "Start over") change anything.
  const locked = state.deployed !== null;
  switch (a.type) {
    case "reset":
      return initialState(a.addresses ?? state.addresses);
    case "text":
      return locked ? state : { ...state, text: a.text };
    case "extracted":
      return locked
        ? state
        : { ...initialState(state.addresses), text: a.text, extraction: a.extraction, edited: structuredClone(a.extraction.proposed), step: 2 };
    case "edit":
      return locked || !state.edited ? state : { ...state, edited: applyEdits(state.edited, a.edits), confirmed: null };
    case "resolve":
      return locked ? state : { ...state, resolutions: { ...state.resolutions, [a.resolution.ambiguityId]: a.resolution }, confirmed: null };
    case "unresolve": {
      if (locked) return state;
      const { [a.id]: _gone, ...rest } = state.resolutions;
      return { ...state, resolutions: rest, confirmed: null };
    }
    case "address":
      return locked ? state : { ...state, addresses: { ...state.addresses, [a.role]: a.address }, confirmed: null };
    case "window":
      return locked ? state : { ...state, reviewWindowSeconds: a.seconds, confirmed: null };
    case "goto":
      return { ...state, step: a.step };
    case "confirmed":
      return { ...state, confirmed: a.confirmed };
    case "deployed":
      return { ...state, deployed: { address: a.address, txHash: a.txHash }, step: 6 };
    case "signed":
      return { ...state, signatures: { ...state.signatures, [a.role]: a.txHash } };
    case "funded":
      return { ...state, funded: a.txHash };
  }
}

const KEY = "mv.wizard.v1";

export function loadState(addresses: Record<Role, string>): WizardState {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WizardState;
      if (parsed && typeof parsed === "object" && parsed.step >= 1 && parsed.step <= 6) return parsed;
    }
  } catch {
    /* corrupt or unavailable storage: start fresh */
  }
  return initialState(addresses);
}

export function saveState(state: WizardState): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: the wizard still works */
  }
}

/** Confirmed JSON kept by hash when the server was offline, so "Verify terms" still has something to check against. */
const LOCAL_AGREEMENTS = "mv.agreements.v1";
export function rememberAgreement(hash: string, checklist: ConfirmedChecklist): void {
  try {
    const all = JSON.parse(localStorage.getItem(LOCAL_AGREEMENTS) ?? "{}") as Record<string, ConfirmedChecklist>;
    all[hash] = checklist;
    localStorage.setItem(LOCAL_AGREEMENTS, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
export function recallAgreement(hash: string): ConfirmedChecklist | null {
  try {
    const all = JSON.parse(localStorage.getItem(LOCAL_AGREEMENTS) ?? "{}") as Record<string, ConfirmedChecklist>;
    return all[hash] ?? null;
  } catch {
    return null;
  }
}
