import { describe, expect, it } from "vitest";
import {
  MILESTONE_NAMES,
  buildTimeline,
  formatDuration,
  nextStep,
  planFor,
  reconcileFailures,
  roleOfAddress,
  withdrawPlan,
  type Attempt,
  type MilestoneName,
  type MilestoneView,
  type Parties,
  type RawEvent,
  type ReconcileView,
  type VaultRole,
} from "./vaultModel";

const ROLES: VaultRole[] = ["client", "provider", "arbiter", "stranger"];
const WEI = 10n ** 18n;

const ms = (state: MilestoneName, index = 0, completedAt = 1000n): MilestoneView => ({
  index,
  amount: WEI,
  state,
  deliverableHash: "0x" + "11".repeat(32),
  evidenceHash: "0x" + "00".repeat(32),
  rationaleHash: "0x" + "00".repeat(32),
  completedAt,
});
const plan = (role: VaultRole, state: MilestoneName, over: { next?: number; index?: number; agreementState?: number; now?: bigint } = {}) =>
  planFor({
    role,
    agreementState: over.agreementState ?? 2,
    nextMilestone: over.next ?? 0,
    milestone: ms(state, over.index ?? 0),
    reviewWindow: 120n,
    chainNow: over.now ?? 1010n,
  });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("planFor: every state x every role", () => {
  it("never offers anything on a settled milestone", () => {
    for (const role of ROLES) for (const s of ["Released", "Refunded"] as const) {
      const p = plan(role, s);
      expect(p.offers).toEqual([]);
      expect(p.tryAnyway).toEqual([]);
    }
  });

  it("offers nothing before the agreement is active, and says what it is waiting for", () => {
    for (const role of ROLES) {
      const signing = plan(role, "Pending", { agreementState: 0 });
      const funding = plan(role, "Pending", { agreementState: 1 });
      expect(signing.offers).toEqual([]);
      expect(signing.waitingText).toMatch(/sign/);
      expect(funding.waitingText).toMatch(/fund/);
    }
  });

  it("offers only the provider 'Submit work' on the next pending milestone", () => {
    for (const role of ROLES) {
      const p = plan(role, "Pending");
      expect(ids(p.offers)).toEqual(role === "provider" ? ["markComplete"] : []);
      expect(p.waitingFor).toBe("provider");
      if (role !== "provider") expect(ids(p.tryAnyway)).toContain("markComplete");
    }
  });

  it("offers approve and dispute only to the client on a completed milestone", () => {
    for (const role of ROLES) {
      const p = plan(role, "Completed");
      const offered = ids(p.offers);
      expect(offered.includes("approve")).toBe(role === "client");
      expect(offered.includes("dispute")).toBe(role === "client");
      expect(offered.includes("escalate")).toBe(role === "provider");
      expect(p.waitingFor).toBe("client");
      // the role-gated actions it cannot take are all reachable through "Try anyway"
      if (role !== "client") expect(ids(p.tryAnyway)).toEqual(expect.arrayContaining(["approve", "dispute"]));
      if (role !== "provider") expect(ids(p.tryAnyway)).toContain("escalate");
    }
  });

  it("offers release and refund only to the arbiter on a disputed milestone", () => {
    for (const role of ROLES) {
      const p = plan(role, "Disputed");
      expect(ids(p.offers)).toEqual(role === "arbiter" ? ["refund", "release"] : []);
      expect(p.waitingFor).toBe("arbiter");
      if (role !== "arbiter") expect(ids(p.tryAnyway)).toContain("release");
    }
  });

  it("locks a later milestone: no offers, a plain reason, and only a probe for the provider", () => {
    for (const role of ROLES) {
      const p = plan(role, "Pending", { index: 1, next: 0 });
      expect(p.offers).toEqual([]);
      expect(p.waitingText).toMatch(/Unlocks after milestone 1/);
      expect(ids(p.tryAnyway)).toEqual(role === "provider" || role === "stranger" ? ["markComplete"] : []);
    }
  });

  it("always explains itself: every disabled offer has a reason and every probe says what to expect", () => {
    for (const role of ROLES) for (const s of MILESTONE_NAMES) for (const index of [0, 1]) for (const agreementState of [0, 1, 2, 3]) {
      const p = plan(role, s, { index, agreementState });
      for (const o of p.offers) expect(o.label.length).toBeGreaterThan(0);
      for (const t of p.tryAnyway) {
        expect(t.label.length).toBeGreaterThan(0);
        expect(t.why.length).toBeGreaterThan(0);
      }
      if (p.offers.length === 0 && p.tryAnyway.length === 0 && s !== "Released" && s !== "Refunded" && agreementState !== 3) {
        expect(p.waitingText.length).toBeGreaterThan(0);
      }
    }
  });

  it("disables 'Escalate' with a countdown until completedAt + reviewWindow, and enables it exactly then", () => {
    const early = plan("provider", "Completed", { now: 1119n }).offers.find((o) => o.id === "escalate")!;
    expect(early.disabledReason).toMatch(/Available in 1 s/);
    const onTime = plan("provider", "Completed", { now: 1120n }).offers.find((o) => o.id === "escalate")!;
    expect(onTime.disabledReason).toBeUndefined();
    const planAfter = plan("client", "Completed", { now: 1120n });
    expect(planAfter.waitingText).toMatch(/review window has ended/);
  });
});

describe("withdrawPlan", () => {
  it("enables withdrawing only for a client or provider with credit, and explains every other case", () => {
    expect(withdrawPlan("provider", 3n * WEI)).toMatchObject({ enabled: true, label: "Withdraw 3.000 ETH" });
    expect(withdrawPlan("client", 0n)).toMatchObject({ enabled: false, reason: "Nothing owed to you yet.", tryAnyway: true });
    expect(withdrawPlan("arbiter", 5n)).toMatchObject({ enabled: false, tryAnyway: true });
    expect(withdrawPlan("arbiter", 5n).reason).toMatch(/never be paid/);
    expect(withdrawPlan("stranger", 0n).enabled).toBe(false);
  });
});

describe("reconcileFailures", () => {
  const ok: ReconcileView = {
    deposited: 5n * WEI, released: WEI, refunded: 0n, withdrawn: 0n, heldInEscrow: 4n * WEI, heldByMilestones: 4n * WEI,
    owedToParties: WEI, expectedBalance: 5n * WEI, actualBalance: 5n * WEI, surplus: 0n, ok: true,
  };
  it("is empty for a healthy ledger, even with forced surplus", () => {
    expect(reconcileFailures(ok)).toEqual([]);
    expect(reconcileFailures({ ...ok, actualBalance: 6n * WEI, surplus: WEI })).toEqual([]);
  });
  it("names each failing check", () => {
    expect(reconcileFailures({ ...ok, actualBalance: 4n * WEI })[0]).toMatch(/less ETH/);
    expect(reconcileFailures({ ...ok, heldByMilestones: 3n * WEI })[0]).toMatch(/unsettled milestones/);
    expect(reconcileFailures({ ...ok, owedToParties: 0n })[0]).toMatch(/owed/);
    expect(reconcileFailures({ ...ok, actualBalance: 4n * WEI, owedToParties: 0n })).toHaveLength(2);
  });
});

describe("formatDuration", () => {
  it("reads naturally at every scale", () => {
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(42n)).toBe("42 s");
    expect(formatDuration(102)).toBe("1 min 42 s");
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe("3 h 5 min");
    expect(formatDuration(6 * 86400 + 23 * 3600)).toBe("6 days 23 h");
    expect(formatDuration(86400)).toBe("1 day 0 h");
    expect(formatDuration(-5)).toBe("0 s");
  });
});

describe("buildTimeline", () => {
  const A = (n: number) => "0x" + n.toString(16).padStart(40, "0");
  const parties: Parties = {
    client: { name: "Incubation Cell", address: A(1) },
    provider: { name: "KrishiLens team", address: A(2) },
    arbiter: { name: "Faculty mentor", address: A(3) },
  };
  const ev = (name: string, args: Record<string, unknown>, tx: string, block: number, logIndex: number): RawEvent => ({ name, args, txHash: tx, blockNumber: block, logIndex });
  const events: RawEvent[] = [
    ev("MilestoneCompleted", { index: 0n, deliverableHash: "0xaa" }, "0xt1", 10, 0),
    ev("MilestoneApproved", { index: 0n, deliverableHash: "0xaa" }, "0xt2", 12, 0),
    ev("Credited", { to: A(2), amount: WEI }, "0xt2", 12, 1),
    ev("DisputeResolved", { index: 1n, ruling: 1n, rationaleHash: "0xbb" }, "0xt3", 14, 0),
    ev("Credited", { to: A(1), amount: 2n * WEI }, "0xt3", 14, 1),
    ev("AgreementClosed", {}, "0xt3", 14, 2),
  ];
  const txFrom = new Map([["0xt1", A(2)], ["0xt2", A(1)], ["0xt3", A(3)]]);

  it("writes one line per transaction, newest first, and folds Credited and Closed into it", () => {
    const t = buildTimeline(events, txFrom, parties, []);
    expect(t.map((e) => e.id)).toEqual(["0xt3", "0xt2", "0xt1"]);
    expect(t[0].title).toBe("Faculty mentor refunded milestone 2 · 2.000 ETH now owed to Incubation Cell · agreement closed");
    expect(t[1].title).toBe("Incubation Cell approved milestone 1 · 1.000 ETH now owed to KrishiLens team");
    expect(t[2].title).toBe("KrishiLens team submitted milestone 1");
    expect(t[1].meta).toBe("Client · block 12");
    expect(t[1].details).toHaveLength(2);
  });

  it("puts a rejected attempt right after the real events of the block it was tried in", () => {
    const attempt: Attempt = {
      id: "a1", block: 12, seq: 1, role: "client", actor: A(1), action: "Approve again", errorName: "InvalidMilestoneState",
      title: "That step isn't allowed now", raw: "InvalidMilestoneState(index: 0, actual: Released)",
    };
    const t = buildTimeline(events, txFrom, parties, [attempt]);
    expect(t.map((e) => e.id)).toEqual(["0xt3", "a1", "0xt2", "0xt1"]);
    expect(t[1]).toMatchObject({ ok: false, title: "Rejected: that step isn't allowed now" });
    expect(t[1].meta).toMatch(/nothing changed/);
  });

  it("names a stranger by role and an unknown actor by short address", () => {
    expect(roleOfAddress(parties, A(9))).toBe("stranger");
    expect(roleOfAddress(parties, A(1).toUpperCase().replace("0X", "0x"))).toBe("client");
    expect(roleOfAddress(parties, undefined)).toBe("stranger");
    const t = buildTimeline([ev("Withdrawn", { to: A(9), amount: WEI }, "0xt9", 20, 0)], new Map([["0xt9", A(9)]]), parties, []);
    expect(t[0].title).toMatch(/^0x0000…0009 withdrew 1.000 ETH$/);
    expect(t[0].meta).toBe("Stranger · block 20");
  });
});

describe("nextStep", () => {
  const base = { agreementState: 2, nextMilestone: 0, milestones: [ms("Pending")], credits: { client: 0n, provider: 0n }, reviewWindow: 120n, chainNow: 1010n };
  it("names the actor and says whether it is you", () => {
    expect(nextStep({ ...base, role: "provider" })).toMatchObject({ actor: "provider", mine: true, headline: "Your move: submit the work for milestone 1." });
    expect(nextStep({ ...base, role: "client" })).toMatchObject({ actor: "provider", mine: false, headline: "Next: the provider submits milestone 1." });
    const completed = { ...base, milestones: [ms("Completed")] };
    expect(nextStep({ ...completed, role: "client" })).toMatchObject({ actor: "client", mine: true });
    expect(nextStep({ ...completed, role: "client" }).detail).toMatch(/provider can escalate in 1 min 50 s/);
    expect(nextStep({ ...completed, role: "arbiter", chainNow: 1200n }).detail).toMatch(/review window has ended/);
    expect(nextStep({ ...base, role: "arbiter", milestones: [ms("Disputed")] })).toMatchObject({ actor: "arbiter", mine: true });
  });
  it("covers the agreement states and money waiting to be withdrawn", () => {
    expect(nextStep({ ...base, role: "client", agreementState: 0 }).headline).toMatch(/both signatures/);
    expect(nextStep({ ...base, role: "client", agreementState: 1 })).toMatchObject({ actor: "client", mine: true });
    const closed = nextStep({ ...base, role: "provider", agreementState: 3, credits: { client: 0n, provider: 2n * WEI } });
    expect(closed.headline).toBe("Every milestone is settled.");
    expect(closed.detail).toMatch(/provider has 2.000 ETH to withdraw/);
    expect(nextStep({ ...base, role: "stranger", agreementState: 3 }).detail).toBe("Nothing is left in escrow.");
  });
});
