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

  it("blocks a re-entrancy attack", async () => {
    const [client, , arbiter] = await ethers.getSigners();
    const attacker = await ethers.deployContract("ReentrantProvider");
    const vault = await ethers.deployContract("MilestoneVault", [
      client.address,
      await attacker.getAddress(),
      arbiter.address,
      AGREEMENT_HASH,
      AMOUNTS,
      REVIEW_WINDOW,
    ]);
    await attacker.setVault(await vault.getAddress());

    await vault.connect(client).sign(AGREEMENT_HASH);
    await attacker.sign(AGREEMENT_HASH);
    await vault.connect(client).fund({ value: TOTAL });
    await attacker.markComplete(0, deliverableOf(0));
    await vault.connect(client).approve(0, deliverableOf(0));
    expect(await vault.credits(await attacker.getAddress())).to.equal(AMOUNTS[0]);

    await attacker.attackWithdraw();

    const attempts = await attacker.reentryAttempts();
    expect(attempts).to.be.gte(1n);
    expect(await attacker.reentryBlocked()).to.equal(attempts);
    expect(await attacker.reentrySucceeded()).to.equal(0n);
    // The re-entry was stopped by the reentrancy guard itself.
    expect(await attacker.lastRevertSelector()).to.equal(ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10));
    // The attacker received exactly what it was owed, once.
    expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(AMOUNTS[0]);
    expect(await vault.credits(await attacker.getAddress())).to.equal(0n);
    expect(await vault.totalWithdrawn()).to.equal(AMOUNTS[0]);
    await expectReconciled(vault);
    expect((await vault.reconcile()).actualBalance).to.equal(TOTAL - AMOUNTS[0]);
  });
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

describe("Attack contracts (the attackers are real, the product survives them)", () => {
  it("naive escrow is drained by the same attack pattern (contrast)", async () => {
    const [, drainerFunder, victimA, victimB] = await ethers.getSigners();
    const escrow = await ethers.deployContract("NaiveEscrow");
    const drainer = await ethers.deployContract("NaiveDrainer", [await escrow.getAddress()]);
    const drainerAddr = await drainer.getAddress();
    const escrowAddr = await escrow.getAddress();

    // The drainer is owed 1 ETH; two honest users are owed 1.5 ETH each.
    await escrow.connect(drainerFunder).deposit(drainerAddr, { value: ethers.parseEther("1") });
    await escrow.connect(victimA).deposit(victimA.address, { value: ethers.parseEther("1.5") });
    await escrow.connect(victimB).deposit(victimB.address, { value: ethers.parseEther("1.5") });
    expect(await ethers.provider.getBalance(escrowAddr)).to.equal(ethers.parseEther("4"));

    await drainer.attack();

    // It was owed 1 ETH and walked away with all 4: the victims' money.
    expect(await ethers.provider.getBalance(drainerAddr)).to.equal(ethers.parseEther("4"));
    expect(await ethers.provider.getBalance(escrowAddr)).to.equal(0n);
    expect(await drainer.reentries()).to.be.gte(1n);
    // The victims still "have" credit on the books, but there is nothing left to pay it.
    expect(await escrow.credits(victimA.address)).to.equal(ethers.parseEther("1.5"));
    await expect(escrow.connect(victimA).withdraw()).to.be.reverted;
    await expect(escrow.connect(victimB).withdraw()).to.be.reverted;
  });

  it("force-sent ETH is reported as surplus and cannot be withdrawn", async () => {
    const ctx = await loadFixture(activeFixture);
    const { vault, client, provider } = ctx;
    const forced = ethers.parseEther("0.3");
    const sender = await ethers.deployContract("ForceSender", { value: forced });
    await sender.boom(await vault.getAddress());

    let r = await vault.reconcile();
    expect(r.surplus).to.equal(forced);
    expect(r.ok).to.equal(true);
    expect(r.actualBalance).to.equal(TOTAL + forced);
    await expectReconciled(vault);

    // Run the whole agreement and let both parties take everything they are owed.
    for (let i = 0; i < 3; i++) {
      await completeMilestone(ctx, i);
      await vault.connect(client).approve(i, deliverableOf(i));
    }
    await vault.connect(provider).withdraw();
    await expectReconciled(vault);

    // Nobody can pull the surplus: both credits are zero and nothing else is withdrawable.
    for (const who of [client, provider, ctx.arbiter, ctx.stranger]) {
      await expect(vault.connect(who).withdraw()).to.be.revertedWithCustomError(vault, "NothingToWithdraw");
    }
    r = await vault.reconcile();
    expect(r.actualBalance).to.equal(forced);
    expect(r.surplus).to.equal(forced);
    expect(r.expectedBalance).to.equal(0n);
    expect(r.ok).to.equal(true);
  });

  it("restores the credit and the books when the payout fails (TransferFailed)", async () => {
    const [client, , arbiter] = await ethers.getSigners();
    const rejecting = await ethers.deployContract("RejectingProvider");
    const vault = await ethers.deployContract("MilestoneVault", [
      client.address,
      await rejecting.getAddress(),
      arbiter.address,
      AGREEMENT_HASH,
      AMOUNTS,
      REVIEW_WINDOW,
    ]);
    await rejecting.setVault(await vault.getAddress());
    await vault.connect(client).sign(AGREEMENT_HASH);
    await rejecting.sign(AGREEMENT_HASH);
    await vault.connect(client).fund({ value: TOTAL });
    await rejecting.markComplete(0, deliverableOf(0));
    await vault.connect(client).approve(0, deliverableOf(0));

    await expect(rejecting.pull()).to.be.revertedWithCustomError(vault, "TransferFailed");

    expect(await vault.credits(await rejecting.getAddress())).to.equal(AMOUNTS[0]);
    expect(await vault.totalWithdrawn()).to.equal(0n);
    await expectReconciled(vault);
  });
});
