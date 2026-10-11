import { formatWei, shortHash } from "../ui/copy";

/**
 * Pure rules for the vault screen: who may do what next, how raw events read as a story, and which ledger check failed.
 * No React and no chain calls, so the "disabled buttons always say why" promise is a table test (vaultModel.test.ts).
 * The CONTRACT still decides every transaction; this only chooses what to offer and what to explain.
 */

export type VaultRole = "client" | "provider" | "arbiter" | "stranger";
export type MilestoneName = "Pending" | "Completed" | "Disputed" | "Released" | "Refunded";
export const MILESTONE_NAMES: MilestoneName[] = ["Pending", "Completed", "Disputed", "Released", "Refunded"];
export const AGREEMENT_NAMES = ["Awaiting signatures", "Awaiting funding", "Active", "Closed"] as const;

export interface MilestoneView {
  index: number;
  amount: bigint;
  state: MilestoneName;
  deliverableHash: string;
  evidenceHash: string;
  rationaleHash: string;
  completedAt: bigint;
}

export type ActionId = "markComplete" | "approve" | "dispute" | "escalate" | "release" | "refund";

export interface ActionOffer {
  id: ActionId;
  label: string;
  /** Present when the button is shown but cannot be used yet: the reason is always printed next to it. */
  disabledReason?: string;
}

export interface TryAnyway {
  id: ActionId;
  label: string;
  /** What the contract is expected to say, in plain words (shown under the menu item). */
  why: string;
}

export interface MilestonePlan {
  /** Who has to act next, or null when nobody does (settled, locked, or the agreement is not active). */
  waitingFor: VaultRole | null;
  /** One sentence, e.g. "Waiting for the client to approve or dispute." */
  waitingText: string;
  offers: ActionOffer[];
  tryAnyway: TryAnyway[];
}

export interface PlanInput {
  role: VaultRole;
  agreementState: number;
  nextMilestone: number;
  milestone: MilestoneView;
  reviewWindow: bigint;
  /** Chain time in seconds (the chain's clock, never the laptop's). */
  chainNow: bigint;
}

export function formatDuration(totalSeconds: bigint | number): string {
  let s = Math.max(0, Math.floor(Number(totalSeconds)));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d > 0) return `${d} day${d === 1 ? "" : "s"} ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}

/** What each role may be offered on a milestone, and what goes under "Try anyway". */
export function planFor(i: PlanInput): MilestonePlan {
  const { role, milestone: m } = i;
  const none = (waitingText: string): MilestonePlan => ({ waitingFor: null, waitingText, offers: [], tryAnyway: [] });

  if (m.state === "Released" || m.state === "Refunded") return none("");
  if (i.agreementState < 2) {
    return none(i.agreementState === 0 ? "Waiting for the client and the provider to sign the agreement." : "Waiting for the client to fund the escrow.");
  }
  if (i.agreementState === 3) return none("");

  const offers: ActionOffer[] = [];
  const tryAnyway: TryAnyway[] = [];
  const next = i.nextMilestone;

  if (m.index !== next) {
    // A later milestone: locked. Only the provider is tempted to jump ahead, so only the provider gets the probe.
    if (role === "provider" || role === "stranger") {
      tryAnyway.push({ id: "markComplete", label: "Mark complete now", why: role === "provider" ? "Milestones go in order" : "Only the provider can do this" });
    }
    return { waitingFor: null, waitingText: `Unlocks after milestone ${next + 1} is settled.`, offers, tryAnyway };
  }

  if (m.state === "Pending") {
    if (role === "provider") offers.push({ id: "markComplete", label: "Submit work…" });
    else tryAnyway.push({ id: "markComplete", label: "Mark complete", why: "Only the provider can do this" });
    tryAnyway.push({ id: "approve", label: "Approve this milestone", why: role === "client" ? "Nothing has been submitted yet" : "Only the client can approve" });
    return { waitingFor: "provider", waitingText: "Waiting for the provider to submit the work.", offers, tryAnyway };
  }

  if (m.state === "Completed") {
    const readyAt = m.completedAt + i.reviewWindow;
    const left = readyAt - i.chainNow;
    const window = left > 0n ? `Review window: ${formatDuration(left)} left.` : "The review window has ended, so the provider may escalate.";
    if (role === "client") {
      offers.push({ id: "approve", label: "Approve with file…" }, { id: "dispute", label: "Dispute…" });
    } else {
      tryAnyway.push({ id: "approve", label: "Approve this milestone", why: "Only the client can approve" });
      tryAnyway.push({ id: "dispute", label: "Dispute this milestone", why: "Only the client can dispute" });
    }
    if (role === "provider") {
      offers.push(
        left > 0n
          ? { id: "escalate", label: "Escalate to arbiter", disabledReason: `Available in ${formatDuration(left)}, once the client's review window ends` }
          : { id: "escalate", label: "Escalate to arbiter" },
      );
    } else {
      tryAnyway.push({ id: "escalate", label: "Escalate to the arbiter", why: "Only the provider can escalate" });
    }
    tryAnyway.push({ id: "refund", label: "Refund to the client", why: role === "arbiter" ? "Refunds only follow a dispute" : "Only the arbiter can refund, and only after a dispute" });
    return { waitingFor: "client", waitingText: `Waiting for the client to approve or dispute. ${window}`, offers, tryAnyway };
  }

  // Disputed
  if (role === "arbiter") {
    offers.push({ id: "release", label: "Release to the provider" }, { id: "refund", label: "Refund the client" });
  } else {
    tryAnyway.push({ id: "release", label: "Settle the dispute", why: "Only the arbiter can do this" });
  }
  tryAnyway.push({ id: "approve", label: "Approve this milestone", why: role === "client" ? "A disputed milestone can't be approved" : "Only the client can approve" });
  return { waitingFor: "arbiter", waitingText: "Waiting for the arbiter to settle the dispute.", offers, tryAnyway };
}

export interface WithdrawPlan {
  enabled: boolean;
  label: string;
  /** Why the button is off (or what the role can never do). */
  reason: string;
  /** The probe under "Try anyway" (always available so a judge can watch the contract refuse). */
  tryAnyway: boolean;
}

export function withdrawPlan(role: VaultRole, credit: bigint): WithdrawPlan {
  if (role === "arbiter") return { enabled: false, label: "Withdraw", reason: "The arbiter can never be paid from this vault.", tryAnyway: true };
  if (role === "stranger") return { enabled: false, label: "Withdraw", reason: "Nothing is owed to this account.", tryAnyway: true };
  if (credit === 0n) return { enabled: false, label: "Withdraw", reason: "Nothing owed to you yet.", tryAnyway: true };
  return { enabled: true, label: `Withdraw ${formatWei(credit)} ETH`, reason: "", tryAnyway: false };
}

// ───────────────────────── ledger ─────────────────────────

export interface ReconcileView {
  deposited: bigint;
  released: bigint;
  refunded: bigint;
  withdrawn: bigint;
  heldInEscrow: bigint;
  heldByMilestones: bigint;
  owedToParties: bigint;
  expectedBalance: bigint;
  actualBalance: bigint;
  surplus: bigint;
  ok: boolean;
}

/** The three checks reconcile() makes, named in words, so a red ledger says exactly what failed. */
export function reconcileFailures(r: ReconcileView): string[] {
  const out: string[] = [];
  if (r.actualBalance < r.expectedBalance) out.push("The contract holds less ETH than deposits minus withdrawals.");
  if (r.heldInEscrow !== r.heldByMilestones) out.push("The money in escrow doesn't equal the unsettled milestones.");
  if (r.owedToParties !== r.released + r.refunded - r.withdrawn) out.push("The balances owed don't equal paid out minus withdrawn.");
  return out;
}

// ───────────────────────── timeline ─────────────────────────

export interface RawEvent {
  name: string;
  args: Record<string, unknown>;
  txHash: string;
  blockNumber: number;
  logIndex: number;
}

export interface Party {
  name: string;
  address: string;
}
export type Parties = Record<"client" | "provider" | "arbiter", Party>;

export interface Attempt {
  id: string;
  /** Block height when it was tried: orders it among real events. */
  block: number;
  seq: number;
  role: VaultRole;
  actor: string;
  action: string;
  errorName: string;
  title: string;
  raw: string;
}

export interface TimelineEntry {
  id: string;
  ok: boolean;
  title: string;
  /** "Client · block 52" */
  meta: string;
  txHash?: string;
  /** Raw decoded events or the raw error, for the expandable row. */
  details: string[];
  sortKey: number;
}

const nameOf = (parties: Parties, address: string): string => {
  const a = address.toLowerCase();
  for (const r of ["client", "provider", "arbiter"] as const) if (parties[r].address.toLowerCase() === a) return parties[r].name;
  return shortHash(address);
};
export const roleOfAddress = (parties: Parties, address: string | null | undefined): VaultRole => {
  const a = (address ?? "").toLowerCase();
  for (const r of ["client", "provider", "arbiter"] as const) if (parties[r].address.toLowerCase() === a) return r;
  return "stranger";
};
const ROLE_TITLE: Record<VaultRole, string> = { client: "Client", provider: "Provider", arbiter: "Arbiter", stranger: "Stranger" };
const eth = (v: unknown): string => `${formatWei(BigInt(v as bigint))} ETH`;
const mile = (v: unknown): number => Number(v as bigint) + 1;

function rawLine(e: RawEvent): string {
  const args = Object.entries(e.args)
    .map(([k, v]) => `${k}: ${typeof v === "bigint" ? v.toString() : String(v)}`)
    .join(", ");
  return `${e.name}(${args})`;
}

/**
 * One line per TRANSACTION, not per event: an approval emits Approved + Credited (+ Closed), and the story is
 * "Client approved milestone 1, 1.000 ETH now owed to the provider". Rejected attempts are merged in by block.
 */
export function buildTimeline(events: RawEvent[], txFrom: Map<string, string>, parties: Parties, attempts: Attempt[]): TimelineEntry[] {
  const byTx = new Map<string, RawEvent[]>();
  for (const e of events) {
    const list = byTx.get(e.txHash) ?? [];
    list.push(e);
    byTx.set(e.txHash, list);
  }
  const entries: TimelineEntry[] = [];
  for (const [txHash, group] of byTx) {
    group.sort((a, b) => a.logIndex - b.logIndex);
    const main = group.find((e) => e.name !== "Credited" && e.name !== "AgreementClosed") ?? group[0];
    const credited = group.find((e) => e.name === "Credited");
    const closed = group.some((e) => e.name === "AgreementClosed");
    const actor = txFrom.get(txHash) ?? "";
    const role = roleOfAddress(parties, actor);
    const who = nameOf(parties, actor);
    let title: string;
    switch (main.name) {
      case "AgreementSigned":
        title = `${who} signed the agreement`;
        break;
      case "AgreementFunded":
        title = `${who} funded the escrow with ${eth(main.args.amount)}`;
        break;
      case "MilestoneCompleted":
        title = `${who} submitted milestone ${mile(main.args.index)}`;
        break;
      case "MilestoneApproved":
        title = `${who} approved milestone ${mile(main.args.index)}${credited ? ` · ${eth(credited.args.amount)} now owed to ${nameOf(parties, String(credited.args.to))}` : ""}`;
        break;
      case "MilestoneDisputed":
        title = `${who} disputed milestone ${mile(main.args.index)}`;
        break;
      case "MilestoneEscalated":
        title = `${who} escalated milestone ${mile(main.args.index)} to the arbiter`;
        break;
      case "DisputeResolved": {
        const refund = Number(main.args.ruling as bigint) === 1;
        title = `${who} ${refund ? "refunded" : "released"} milestone ${mile(main.args.index)}${credited ? ` · ${eth(credited.args.amount)} now owed to ${nameOf(parties, String(credited.args.to))}` : ""}`;
        break;
      }
      case "Withdrawn":
        title = `${who} withdrew ${eth(main.args.amount)}`;
        break;
      default:
        title = main.name;
    }
    if (closed) title += " · agreement closed";
    entries.push({
      id: txHash,
      ok: true,
      title,
      meta: `${ROLE_TITLE[role]} · block ${main.blockNumber}`,
      txHash,
      details: group.map(rawLine),
      sortKey: main.blockNumber * 1_000_000 + main.logIndex,
    });
  }
  for (const a of attempts) {
    entries.push({
      id: a.id,
      ok: false,
      title: `Rejected: ${a.title.toLowerCase()}`,
      meta: `Tried by ${ROLE_TITLE[a.role]} (${a.action}) · nothing changed · block ${a.block}`,
      details: [a.raw],
      // After the real events of the block it was tried in.
      sortKey: a.block * 1_000_000 + 500_000 + a.seq,
    });
  }
  return entries.sort((x, y) => y.sortKey - x.sortKey);
}

// ───────────────────────── "your move" ─────────────────────────

export interface NextStep {
  /** Who has to act next (null when nobody does). */
  actor: VaultRole | null;
  /** True when the current account is that actor. */
  mine: boolean;
  headline: string;
  /** A second line when it helps: what the other roles can do, or money waiting to be withdrawn. */
  detail: string;
}

export interface NextStepInput {
  role: VaultRole;
  agreementState: number;
  nextMilestone: number;
  milestones: MilestoneView[];
  credits: { client: bigint; provider: bigint };
  reviewWindow: bigint;
  chainNow: bigint;
}

const ACTOR_WORD: Record<VaultRole, string> = { client: "the client", provider: "the provider", arbiter: "the arbiter", stranger: "anyone" };

/** The one sentence that answers "what happens next, and is it me?" (docs/08: who can do what next). */
export function nextStep(i: NextStepInput): NextStep {
  const withdrawHint = (): string => {
    const parts: string[] = [];
    if (i.credits.provider > 0n) parts.push(`the provider has ${formatWei(i.credits.provider)} ETH to withdraw`);
    if (i.credits.client > 0n) parts.push(`the client has ${formatWei(i.credits.client)} ETH to withdraw`);
    return parts.length ? `Also: ${parts.join(" and ")}.` : "";
  };
  if (i.agreementState === 0) return { actor: null, mine: false, headline: "The agreement is waiting for both signatures.", detail: "No money can move until the client and the provider sign the same seal." };
  if (i.agreementState === 1) return { actor: "client", mine: i.role === "client", headline: i.role === "client" ? "Your move: fund the escrow." : "The agreement is waiting for the client to fund it.", detail: "Both parties have signed. Funding locks the exact total in the vault." };
  if (i.agreementState === 3) return { actor: null, mine: false, headline: "Every milestone is settled.", detail: withdrawHint() || "Nothing is left in escrow." };

  const m = i.milestones[i.nextMilestone];
  if (!m) return { actor: null, mine: false, headline: "Every milestone is settled.", detail: withdrawHint() };
  const n = m.index + 1;
  const tail = withdrawHint();
  if (m.state === "Pending") {
    const mine = i.role === "provider";
    return { actor: "provider", mine, headline: mine ? `Your move: submit the work for milestone ${n}.` : `Next: the provider submits milestone ${n}.`, detail: tail };
  }
  if (m.state === "Completed") {
    const left = m.completedAt + i.reviewWindow - i.chainNow;
    const mine = i.role === "client";
    const providerNote = left > 0n ? `The provider can escalate in ${formatDuration(left)}.` : "The review window has ended, so the provider can escalate.";
    return {
      actor: "client",
      mine,
      headline: mine ? `Your move: approve or dispute milestone ${n}.` : `Next: the client reviews milestone ${n}.`,
      detail: [providerNote, tail].filter(Boolean).join(" "),
    };
  }
  const mine = i.role === "arbiter";
  return { actor: "arbiter", mine, headline: mine ? `Your move: settle the dispute on milestone ${n}.` : `Next: the arbiter settles the dispute on milestone ${n}.`, detail: tail };
}
export const actorWord = (r: VaultRole): string => ACTOR_WORD[r];
