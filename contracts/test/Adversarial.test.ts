import { expect } from "chai";
import { ethers } from "hardhat";
import {
  AGREEMENT_HASH,
  AMOUNTS,
  AgreementState,
  MilestoneState,
  REVIEW_WINDOW,
  Ruling,
  TOTAL,
  activeFixture,
  completeMilestone,
  deliverableOf,
  deployedFixture,
  evidenceOf,
  expectReconciled,
  hashOf,
  loadFixture,
  m0Completed,
  m0Disputed,
  m0Released,
  rationaleOf,
  signedFixture,
  time,
} from "./helpers/fixtures";

describe("Booklet-required adversarial tests", () => {
  it("rejects a second release attempt", async () => {
    const ctx = await loadFixture(m0Released);
    const { vault, client, provider, arbiter } = ctx;
    const creditBefore = await vault.credits(provider.address);
    const releasedBefore = (await vault.reconcile()).released;
    expect(creditBefore).to.equal(AMOUNTS[0]);

    // The client tries to approve the same milestone again.
    await expect(vault.connect(client).approve(0, deliverableOf(0)))
      .to.be.revertedWithCustomError(vault, "InvalidMilestoneState")
      .withArgs(0, MilestoneState.Released);
    // The arbiter tries to release it a second time through a "ruling".
    await expect(vault.connect(arbiter).resolve(0, Ruling.Release, rationaleOf(0)))
      .to.be.revertedWithCustomError(vault, "InvalidMilestoneState")
      .withArgs(0, MilestoneState.Released);
    // ... or to flip it into a refund.
    await expect(vault.connect(arbiter).resolve(0, Ruling.Refund, rationaleOf(0)))
      .to.be.revertedWithCustomError(vault, "InvalidMilestoneState")
      .withArgs(0, MilestoneState.Released);

    expect(await vault.credits(provider.address)).to.equal(creditBefore);
    expect((await vault.reconcile()).released).to.equal(releasedBefore);
    await expectReconciled(vault);
  });

  it("rejects an unauthorized refund", async () => {
    const ctx = await loadFixture(m0Disputed);
    const { vault, client, provider, arbiter, stranger } = ctx;
    const before = await vault.reconcile();

    // Only the arbiter can rule. The client (who is "owed" the refund) cannot grant it to themself.
    for (const who of [client, provider, stranger]) {
      await expect(vault.connect(who).resolve(0, Ruling.Refund, rationaleOf(0))).to.be.revertedWithCustomError(
        vault,
        "NotArbiter",
      );
    }
    expect(await vault.credits(client.address)).to.equal(0);

    // Even the arbiter cannot refund a milestone that is not Disputed (M1 is still Pending).
    await expect(vault.connect(arbiter).resolve(1, Ruling.Refund, rationaleOf(1)))
      .to.be.revertedWithCustomError(vault, "InvalidMilestoneState")
      .withArgs(1, MilestoneState.Pending);

    const after = await vault.reconcile();
    expect(after.refunded).to.equal(before.refunded).and.to.equal(0);
    expect(await vault.credits(client.address)).to.equal(0);
    expect((await vault.getMilestone(0)).state).to.equal(MilestoneState.Disputed);
    await expectReconciled(vault);
  });

  it("rejects an out-of-order transition", async () => {
    const ctx = await loadFixture(activeFixture);
    const { vault, client, provider, arbiter } = ctx;

    // approve before markComplete
    await expect(vault.connect(client).approve(0, deliverableOf(0)))
      .to.be.revertedWithCustomError(vault, "InvalidMilestoneState")
      .withArgs(0, MilestoneState.Pending);
    // dispute before markComplete
    await expect(vault.connect(client).dispute(0, evidenceOf(0)))
      .to.be.revertedWithCustomError(vault, "InvalidMilestoneState")
      .withArgs(0, MilestoneState.Pending);
    // resolve before dispute
    await expect(vault.connect(arbiter).resolve(0, Ruling.Release, rationaleOf(0)))
      .to.be.revertedWithCustomError(vault, "InvalidMilestoneState")
      .withArgs(0, MilestoneState.Pending);
    // escalate before markComplete
    await expect(vault.connect(provider).escalate(0))
      .to.be.revertedWithCustomError(vault, "InvalidMilestoneState")
      .withArgs(0, MilestoneState.Pending);
    // markComplete(1) before M0 is terminal
    await expect(vault.connect(provider).markComplete(1, deliverableOf(1)))
      .to.be.revertedWithCustomError(vault, "MilestoneOutOfOrder")
      .withArgs(1, 0);
    await expectReconciled(vault);

    // fund before both signatures
    const early = await loadFixture(deployedFixture);
    await expect(early.vault.connect(early.client).fund({ value: TOTAL }))
      .to.be.revertedWithCustomError(early.vault, "WrongAgreementState")
      .withArgs(AgreementState.AwaitingSignatures);
    await early.vault.connect(early.client).sign(AGREEMENT_HASH); // only one of two signatures
    await expect(early.vault.connect(early.client).fund({ value: TOTAL }))
      .to.be.revertedWithCustomError(early.vault, "WrongAgreementState")
      .withArgs(AgreementState.AwaitingSignatures);
  });

  // Implemented in P03 (needs contracts/contracts/attack/ReentrantProvider.sol).
  it.skip("blocks a re-entrancy attack");
});

describe("Further guarantees", () => {
  it("rejects approval of a swapped deliverable", async () => {
    const ctx = await loadFixture(m0Completed);
    const { vault, client } = ctx;
    const swapped = hashOf("a different file the provider sent after the review");
    await expect(vault.connect(client).approve(0, swapped))
      .to.be.revertedWithCustomError(vault, "DeliverableHashMismatch")
      .withArgs(deliverableOf(0), swapped);
    expect((await vault.getMilestone(0)).state).to.equal(MilestoneState.Completed);
    expect(await vault.credits(ctx.provider.address)).to.equal(0);
    await expectReconciled(vault);
  });

  it("rejects wrong funding amounts (both less and more)", async () => {
    const { vault, client } = await loadFixture(signedFixture);
    await expect(vault.connect(client).fund({ value: TOTAL - 1n }))
      .to.be.revertedWithCustomError(vault, "WrongFundingAmount")
      .withArgs(TOTAL, TOTAL - 1n);
    await expect(vault.connect(client).fund({ value: TOTAL + 1n }))
      .to.be.revertedWithCustomError(vault, "WrongFundingAmount")
      .withArgs(TOTAL, TOTAL + 1n);
    await expect(vault.connect(client).fund({ value: 0 }))
      .to.be.revertedWithCustomError(vault, "WrongFundingAmount")
      .withArgs(TOTAL, 0);
    expect(await vault.agreementState()).to.equal(AgreementState.AwaitingFunding);
  });

  it("rejects funding twice", async () => {
    const { vault, client } = await loadFixture(activeFixture);
    await expect(vault.connect(client).fund({ value: TOTAL }))
      .to.be.revertedWithCustomError(vault, "WrongAgreementState")
      .withArgs(AgreementState.Active);
    await expectReconciled(vault);
    expect(await vault.totalDeposited()).to.equal(TOTAL);
  });

  it("rejects direct ETH transfers, with or without calldata", async () => {
    const { vault, stranger } = await loadFixture(activeFixture);
    const to = await vault.getAddress();
    await expect(stranger.sendTransaction({ to, value: 1n })).to.be.revertedWithCustomError(
      vault,
      "DirectPaymentNotAccepted",
    );
    await expect(stranger.sendTransaction({ to, value: 1n, data: "0xdeadbeef" })).to.be.revertedWithCustomError(
      vault,
      "DirectPaymentNotAccepted",
    );
    await expect(stranger.sendTransaction({ to, data: "0xdeadbeef" })).to.be.revertedWithCustomError(
      vault,
      "DirectPaymentNotAccepted",
    );
    await expectReconciled(vault);
    expect((await vault.reconcile()).surplus).to.equal(0);
  });

  it("rejects signing a different agreement hash", async () => {
    const { vault, client } = await loadFixture(deployedFixture);
    const other = hashOf("a doctored agreement");
    await expect(vault.connect(client).sign(other))
      .to.be.revertedWithCustomError(vault, "AgreementHashMismatch")
      .withArgs(AGREEMENT_HASH, other);
    expect(await vault.clientSigned()).to.equal(false);
  });

  it("rejects signing twice", async () => {
    const { vault, client, provider } = await loadFixture(deployedFixture);
    await vault.connect(client).sign(AGREEMENT_HASH);
    await expect(vault.connect(client).sign(AGREEMENT_HASH))
      .to.be.revertedWithCustomError(vault, "AlreadySigned")
      .withArgs(client.address);
    await vault.connect(provider).sign(AGREEMENT_HASH);
    await expect(vault.connect(provider).sign(AGREEMENT_HASH))
      .to.be.revertedWithCustomError(vault, "WrongAgreementState")
      .withArgs(AgreementState.AwaitingFunding);
  });

  it("rejects the provider signing twice before the client has signed", async () => {
    const { vault, client, provider } = await loadFixture(deployedFixture);
    await vault.connect(provider).sign(AGREEMENT_HASH);
    await expect(vault.connect(provider).sign(AGREEMENT_HASH))
      .to.be.revertedWithCustomError(vault, "AlreadySigned")
      .withArgs(provider.address);
    expect(await vault.agreementState()).to.equal(AgreementState.AwaitingSignatures);
    await vault.connect(client).sign(AGREEMENT_HASH);
    expect(await vault.agreementState()).to.equal(AgreementState.AwaitingFunding);
  });

  it("rejects signing by a party that is not the client or provider", async () => {
    const { vault, arbiter, stranger } = await loadFixture(deployedFixture);
    await expect(vault.connect(arbiter).sign(AGREEMENT_HASH)).to.be.revertedWithCustomError(vault, "NotSigner");
    await expect(vault.connect(stranger).sign(AGREEMENT_HASH)).to.be.revertedWithCustomError(vault, "NotSigner");
  });

  it("rejects early escalation until the review window has elapsed (ReviewWindowOpen with the right timestamp)", async () => {
    const ctx = await loadFixture(activeFixture);
    const { vault, provider } = ctx;
    await completeMilestone(ctx, 0);
    const completedAt = (await vault.getMilestone(0)).completedAt;
    const allowedAt = completedAt + BigInt(REVIEW_WINDOW);

    await expect(vault.connect(provider).escalate(0))
      .to.be.revertedWithCustomError(vault, "ReviewWindowOpen")
      .withArgs(allowedAt);

    await time.increaseTo(allowedAt - 1n);
    // the next tx lands one second later (== allowedAt), so move to just before that
    await expect(vault.connect(provider).escalate(0)).to.not.be.reverted;
  });

  it("rejects escalation one second before the window ends and accepts it exactly at the boundary", async () => {
    const ctx = await loadFixture(activeFixture);
    const { vault, provider } = ctx;
    await completeMilestone(ctx, 0);
    const allowedAt = (await vault.getMilestone(0)).completedAt + BigInt(REVIEW_WINDOW);

    await time.setNextBlockTimestamp(allowedAt - 1n);
    await expect(vault.connect(provider).escalate(0)).to.be.revertedWithCustomError(vault, "ReviewWindowOpen");
    await time.setNextBlockTimestamp(allowedAt);
    await expect(vault.connect(provider).escalate(0)).to.emit(vault, "MilestoneEscalated");
  });

  it("rejects withdraw with no credit", async () => {
    const { vault, client, provider, arbiter, stranger } = await loadFixture(activeFixture);
    for (const who of [client, provider, arbiter, stranger]) {
      await expect(vault.connect(who).withdraw()).to.be.revertedWithCustomError(vault, "NothingToWithdraw");
    }
  });

  it("rejects withdraw before the agreement is funded (WrongAgreementState)", async () => {
    const { vault, client } = await loadFixture(signedFixture);
    await expect(vault.connect(client).withdraw())
      .to.be.revertedWithCustomError(vault, "WrongAgreementState")
      .withArgs(AgreementState.AwaitingFunding);
  });

  it("rejects a second withdrawal of the same credit", async () => {
    const { vault, provider } = await loadFixture(m0Released);
    await vault.connect(provider).withdraw();
    await expect(vault.connect(provider).withdraw()).to.be.revertedWithCustomError(vault, "NothingToWithdraw");
    expect(await vault.totalWithdrawn()).to.equal(AMOUNTS[0]);
    await expectReconciled(vault);
  });

  it("rejects approving a disputed milestone (the client cannot overrule the arbiter's queue)", async () => {
    const { vault, client } = await loadFixture(m0Disputed);
    await expect(vault.connect(client).approve(0, deliverableOf(0)))
      .to.be.revertedWithCustomError(vault, "InvalidMilestoneState")
      .withArgs(0, MilestoneState.Disputed);
  });

  it("rejects a dispute after the milestone has been released (the client cannot claw funds back)", async () => {
    const { vault, client } = await loadFixture(m0Released);
    await expect(vault.connect(client).dispute(0, evidenceOf(0)))
      .to.be.revertedWithCustomError(vault, "InvalidMilestoneState")
      .withArgs(0, MilestoneState.Released);
  });

  it("keeps the books reconciled and the surplus visible when ETH is force-sent to the vault", async () => {
    const { vault } = await loadFixture(activeFixture);
    // hardhat_setBalance simulates a selfdestruct-style forced deposit; the real ForceSender test is in P03.
    const addr = await vault.getAddress();
    await ethers.provider.send("hardhat_setBalance", [addr, "0x" + (TOTAL + 123n).toString(16)]);
    const r = await vault.reconcile();
    expect(r.ok).to.equal(true);
    expect(r.surplus).to.equal(123n);
    expect(r.expectedBalance).to.equal(TOTAL);
  });

  it("reports ok == false (and never reverts) if the vault balance ever falls below the books", async () => {
    const { vault } = await loadFixture(activeFixture);
    // Simulated corruption: ETH vanishes from the vault. The Solidity rules cannot do this; the test proves
    // the reconciliation panel would still notice instead of panicking on an underflow.
    await ethers.provider.send("hardhat_setBalance", [await vault.getAddress(), "0x1"]);
    const r = await vault.reconcile();
    expect(r.ok).to.equal(false);
    expect(r.actualBalance).to.equal(1n);
    expect(r.surplus).to.equal(0n);
    expect(r.expectedBalance).to.equal(TOTAL);
  });
});
