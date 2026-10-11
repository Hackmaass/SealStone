import { expect } from "chai";
import {
  AgreementState,
  Ctx,
  MilestoneState,
  REVIEW_WINDOW,
  Ruling,
  activeFixture,
  deliverableOf,
  deployedFixture,
  evidenceOf,
  loadFixture,
  m0FixtureByState,
  rationaleOf,
  signedFixture,
  time,
} from "./helpers/fixtures";

type StateName = keyof typeof m0FixtureByState;
const STATES: StateName[] = ["Pending", "Completed", "Disputed", "Released", "Refunded"];

interface Transition {
  fn: string;
  /** The only milestone state this function may run from (spec: milestone transition table). */
  validFrom: StateName;
  /** Calls the function on milestone 0 with the correct role. */
  call: (c: Ctx) => Promise<unknown>;
}

const TRANSITIONS: Transition[] = [
  { fn: "markComplete", validFrom: "Pending", call: (c) => c.vault.connect(c.provider).markComplete(0, deliverableOf(0)) },
  { fn: "approve", validFrom: "Completed", call: (c) => c.vault.connect(c.client).approve(0, deliverableOf(0)) },
  { fn: "dispute", validFrom: "Completed", call: (c) => c.vault.connect(c.client).dispute(0, evidenceOf(0)) },
  { fn: "escalate", validFrom: "Completed", call: (c) => c.vault.connect(c.provider).escalate(0) },
  {
    fn: "resolve(Release)",
    validFrom: "Disputed",
    call: (c) => c.vault.connect(c.arbiter).resolve(0, Ruling.Release, rationaleOf(0)),
  },
  {
    fn: "resolve(Refund)",
    validFrom: "Disputed",
    call: (c) => c.vault.connect(c.arbiter).resolve(0, Ruling.Refund, rationaleOf(0)),
  },
];

describe("State machine (only the transitions in the spec's table succeed; everything else reverts)", () => {
  // M0 is used throughout while the agreement is still Active (M1 and M2 stay Pending), so the milestone
  // state check is what fires. On the last milestone the agreement would already be Closed.
  for (const t of TRANSITIONS) {
    describe(t.fn, () => {
      for (const state of STATES) {
        if (state === t.validFrom) {
          it(`succeeds from ${state}`, async () => {
            const ctx = await loadFixture(m0FixtureByState[state]);
            await time.increase(REVIEW_WINDOW); // lets escalate pass its window; irrelevant to the others
            await expect(t.call(ctx)).to.not.be.reverted;
          });
        } else {
          it(`rejects ${state} with InvalidMilestoneState(0, ${state})`, async () => {
            const ctx = await loadFixture(m0FixtureByState[state]);
            await time.increase(REVIEW_WINDOW);
            await expect(t.call(ctx))
              .to.be.revertedWithCustomError(ctx.vault, "InvalidMilestoneState")
              .withArgs(0, MilestoneState[state]);
          });
        }
      }
    });
  }

  describe("ordering, agreement state and index checks", () => {
    it("rejects markComplete(1) while M0 is not terminal with MilestoneOutOfOrder(1, 0)", async () => {
      const ctx = await loadFixture(activeFixture);
      await expect(ctx.vault.connect(ctx.provider).markComplete(1, deliverableOf(1)))
        .to.be.revertedWithCustomError(ctx.vault, "MilestoneOutOfOrder")
        .withArgs(1, 0);
    });

    it("still rejects markComplete(1) while M0 is Completed (awaiting review)", async () => {
      const ctx = await loadFixture(m0FixtureByState.Completed);
      await expect(ctx.vault.connect(ctx.provider).markComplete(1, deliverableOf(1)))
        .to.be.revertedWithCustomError(ctx.vault, "MilestoneOutOfOrder")
        .withArgs(1, 0);
    });

    it("accepts markComplete(1) once M0 is terminal, and rejects markComplete(2) before M1 is terminal", async () => {
      const ctx = await loadFixture(m0FixtureByState.Released);
      await expect(ctx.vault.connect(ctx.provider).markComplete(2, deliverableOf(2)))
        .to.be.revertedWithCustomError(ctx.vault, "MilestoneOutOfOrder")
        .withArgs(2, 1);
      await expect(ctx.vault.connect(ctx.provider).markComplete(1, deliverableOf(1))).to.not.be.reverted;
    });

    it("rejects markComplete with a zero deliverable hash", async () => {
      const ctx = await loadFixture(activeFixture);
      await expect(ctx.vault.connect(ctx.provider).markComplete(0, "0x" + "00".repeat(32))).to.be.revertedWithCustomError(
        ctx.vault,
        "ZeroHash",
      );
    });

    const BEFORE_FUNDING: Array<[string, () => Promise<Ctx>, number]> = [
      ["AwaitingSignatures", deployedFixture, AgreementState.AwaitingSignatures],
      ["AwaitingFunding", signedFixture, AgreementState.AwaitingFunding],
    ];
    for (const [label, fixture, actual] of BEFORE_FUNDING) {
      for (const t of TRANSITIONS) {
        it(`rejects ${t.fn} while the agreement is ${label} with WrongAgreementState(${actual})`, async () => {
          const ctx = await loadFixture(fixture);
          await expect(t.call(ctx)).to.be.revertedWithCustomError(ctx.vault, "WrongAgreementState").withArgs(actual);
        });
      }
    }

    const BAD_INDEX = 99;
    const BAD_INDEX_CALLS: Array<[string, (c: Ctx) => Promise<unknown>]> = [
      ["markComplete", (c) => c.vault.connect(c.provider).markComplete(BAD_INDEX, deliverableOf(0))],
      ["approve", (c) => c.vault.connect(c.client).approve(BAD_INDEX, deliverableOf(0))],
      ["dispute", (c) => c.vault.connect(c.client).dispute(BAD_INDEX, evidenceOf(0))],
      ["escalate", (c) => c.vault.connect(c.provider).escalate(BAD_INDEX)],
      ["resolve", (c) => c.vault.connect(c.arbiter).resolve(BAD_INDEX, Ruling.Release, rationaleOf(0))],
    ];
    for (const [fn, call] of BAD_INDEX_CALLS) {
      it(`rejects ${fn} on a non-existent milestone with InvalidMilestone(${BAD_INDEX})`, async () => {
        const ctx = await loadFixture(activeFixture);
        await expect(call(ctx)).to.be.revertedWithCustomError(ctx.vault, "InvalidMilestone").withArgs(BAD_INDEX);
      });
    }

    it("checks the role before the agreement state (a stranger gets NotClient even before funding)", async () => {
      const ctx = await loadFixture(signedFixture);
      await expect(ctx.vault.connect(ctx.stranger).approve(0, deliverableOf(0))).to.be.revertedWithCustomError(
        ctx.vault,
        "NotClient",
      );
    });

    it("a failed call changes no storage (I6): a rejected second approve leaves every counter untouched", async () => {
      const ctx = await loadFixture(m0FixtureByState.Released);
      const before = await ctx.vault.reconcile();
      const milestoneBefore = await ctx.vault.getMilestone(0);
      await expect(ctx.vault.connect(ctx.client).approve(0, deliverableOf(0))).to.be.reverted;
      const after = await ctx.vault.reconcile();
      expect(after.released).to.equal(before.released);
      expect(after.owedToParties).to.equal(before.owedToParties);
      expect((await ctx.vault.getMilestone(0)).state).to.equal(milestoneBefore.state);
      expect(await ctx.vault.nextMilestone()).to.equal(1);
    });
  });
});
