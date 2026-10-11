/** Plain-English copy for every contract error (docs/08 "Copy deck"). Every revert notice ends with "Nothing changed.". */

export const AGREEMENT_STATES = ["awaiting signatures", "awaiting funding", "active", "closed"] as const;
export const MILESTONE_STATES = ["pending", "completed", "disputed", "released", "refunded"] as const;

export interface Explained {
  title: string;
  detail: string;
}

export const shortHash = (h: string): string => (h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);

export function formatWei(wei: bigint, decimals = 3): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const scale = 10n ** BigInt(18 - decimals);
  const rounded = (abs + scale / 2n) / scale; // round half up to `decimals` places
  const whole = rounded / 10n ** BigInt(decimals);
  const frac = (rounded % 10n ** BigInt(decimals)).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}

const asNum = (v: unknown): number => Number(v as bigint | number);
const agreementState = (v: unknown): string => AGREEMENT_STATES[asNum(v)] ?? "in an unknown state";
const milestoneState = (v: unknown): string => MILESTONE_STATES[asNum(v)] ?? "in an unknown state";

const NEXT_AGREEMENT_STEP: Record<string, string> = {
  "awaiting signatures": "Both the client and the provider must sign the agreement hash first.",
  "awaiting funding": "The client must fund the escrow first.",
  active: "",
  closed: "Every milestone is already settled.",
};

const NEXT_MILESTONE_STEP: Record<string, string> = {
  pending: "The provider must mark it complete first.",
  completed: "The client can approve or dispute it.",
  disputed: "Only the arbiter can settle it.",
  released: "It is already settled and can't change.",
  refunded: "It is already settled and can't change.",
};

function untilText(ts: bigint): string {
  const when = new Date(Number(ts) * 1000);
  return Number.isNaN(when.getTime()) ? `timestamp ${ts}` : when.toLocaleTimeString();
}

export function explainRevert(name: string, args: Record<string, unknown> = {}, ctx: { role?: string } = {}): Explained {
  const role = ctx.role ?? "someone else";
  switch (name) {
    case "NotClient":
      return { title: "Only the client can do this", detail: `You're acting as ${role}. Switch to the client to approve or dispute.` };
    case "NotProvider":
      return { title: "Only the provider can do this", detail: "Marking work complete and escalating belong to the provider." };
    case "NotArbiter":
      return { title: "Only the arbiter can settle disputes", detail: "Refunds happen only through the arbiter's ruling." };
    case "NotSigner":
      return { title: "Only the client and provider sign the terms", detail: "" };
    case "WrongAgreementState": {
      const state = agreementState(args.actual);
      return { title: "Not available right now", detail: `The agreement is ${state}. ${NEXT_AGREEMENT_STEP[state] ?? ""}`.trim() };
    }
    case "AgreementHashMismatch":
      return { title: "These aren't the agreed terms", detail: "The hash you signed doesn't match the confirmed agreement." };
    case "AlreadySigned":
      return { title: "Already signed", detail: "" };
    case "WrongFundingAmount":
      return {
        title: "Fund the exact total",
        detail: `Expected ${formatWei(args.expected as bigint)} ETH, received ${formatWei(args.sent as bigint)} ETH.`,
      };
    case "InvalidMilestoneState": {
      const state = milestoneState(args.actual);
      return {
        title: "That step isn't allowed now",
        detail: `Milestone ${asNum(args.index) + 1} is ${state}. ${NEXT_MILESTONE_STEP[state] ?? ""}`.trim(),
      };
    }
    case "MilestoneOutOfOrder":
      return { title: `Finish milestone ${asNum(args.expectedIndex) + 1} first`, detail: "Milestones are completed in order." };
    case "DeliverableHashMismatch":
      return {
        title: "This isn't the file that was submitted",
        detail: `Submitted ${shortHash(String(args.expected))}, yours ${shortHash(String(args.provided))}. Approval only applies to the exact file under review.`,
      };
    case "ReviewWindowOpen":
      return { title: "The client still has time to respond", detail: `You can escalate after ${untilText(args.escalationAllowedAt as bigint)}.` };
    case "NothingToWithdraw":
      return { title: "Nothing owed to you yet", detail: "" };
    case "TransferFailed":
      return { title: "Payment couldn't be delivered", detail: "Your balance is still owed." };
    case "DirectPaymentNotAccepted":
      return { title: "Send money through Fund escrow", detail: "The vault refuses direct transfers." };
    case "InvalidMilestone":
      return { title: "That milestone doesn't exist", detail: "" };
    case "ZeroAddress":
      return { title: "A wallet address is missing", detail: "Client, provider and arbiter each need a wallet." };
    case "DuplicateParty":
      return { title: "Three different parties are required", detail: "Client, provider and arbiter must be three different wallets." };
    case "InvalidMilestoneCount":
      return { title: "An agreement needs 1 to 20 milestones", detail: "" };
    case "ZeroAmount":
      return { title: "Every milestone needs an amount", detail: `Milestone ${asNum(args.index) + 1} has no amount.` };
    case "InvalidReviewWindow":
      return { title: "The review window must be longer than zero", detail: "" };
    case "ZeroHash":
      return { title: "A hash is required", detail: "The file hash can't be empty." };
    case "ReentrancyGuardReentrantCall":
      return { title: "Re-entry blocked", detail: "The vault refuses a second call while a withdrawal is in progress." };
    default:
      return { title: "The contract refused this", detail: name };
  }
}
