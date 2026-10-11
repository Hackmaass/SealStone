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
  loadFixture,
  rationaleOf,
  signedFixture,
  time,
} from "./helpers/fixtures";

describe("Lifecycle (happy paths)", () => {
  it("moves AwaitingSignatures -> AwaitingFunding only after BOTH parties sign, emitting AgreementSigned", async () => {
    const { vault, client, provider } = await loadFixture(deployedFixture);
    await expectReconciled(vault);

    await expect(vault.connect(client).sign(AGREEMENT_HASH))
      .to.emit(vault, "AgreementSigned")
      .withArgs(client.address, AGREEMENT_HASH);
    expect(await vault.agreementState()).to.equal(AgreementState.AwaitingSignatures);
    expect(await vault.clientSigned()).to.equal(true);
    expect(await vault.providerSigned()).to.equal(false);

    await expect(vault.connect(provider).sign(AGREEMENT_HASH))
      .to.emit(vault, "AgreementSigned")
      .withArgs(provider.address, AGREEMENT_HASH);
    expect(await vault.agreementState()).to.equal(AgreementState.AwaitingFunding);
    await expectReconciled(vault);
  });

  it("lets the provider sign first (the order of signatures does not matter)", async () => {
    const { vault, client, provider } = await loadFixture(deployedFixture);
    await vault.connect(provider).sign(AGREEMENT_HASH);
    expect(await vault.agreementState()).to.equal(AgreementState.AwaitingSignatures);
    await vault.connect(client).sign(AGREEMENT_HASH);
    expect(await vault.agreementState()).to.equal(AgreementState.AwaitingFunding);
  });

  it("activates the agreement when the client funds exactly totalAmount, emitting AgreementFunded", async () => {
    const { vault, client } = await loadFixture(signedFixture);
    await expect(vault.connect(client).fund({ value: TOTAL })).to.emit(vault, "AgreementFunded").withArgs(TOTAL);
    expect(await vault.agreementState()).to.equal(AgreementState.Active);
    expect(await vault.totalDeposited()).to.equal(TOTAL);
    await expectReconciled(vault);
    expect((await vault.reconcile()).heldByMilestones).to.equal(TOTAL);
  });

  it("M0 approve releases to the provider's credit, and withdraw pays exactly the milestone amount", async () => {
    const ctx = await loadFixture(activeFixture);
    const { vault, client, provider } = ctx;
    const h = await completeMilestone(ctx, 0);
    await expectReconciled(vault);

    await expect(vault.connect(client).approve(0, h))
      .to.emit(vault, "MilestoneApproved")
      .withArgs(0, h)
      .and.to.emit(vault, "Credited")
      .withArgs(provider.address, AMOUNTS[0]);
    expect((await vault.getMilestone(0)).state).to.equal(MilestoneState.Released);
    expect(await vault.credits(provider.address)).to.equal(AMOUNTS[0]);
    expect(await vault.nextMilestone()).to.equal(1);
    await expectReconciled(vault);

    const before = await ethers.provider.getBalance(provider.address);
    const tx = await vault.connect(provider).withdraw();
    const receipt = await tx.wait();
    const after = await ethers.provider.getBalance(provider.address);
    expect(after - before + receipt!.fee).to.equal(AMOUNTS[0]);
    await expect(tx).to.emit(vault, "Withdrawn").withArgs(provider.address, AMOUNTS[0]);
    expect(await vault.credits(provider.address)).to.equal(0);
    expect(await vault.totalWithdrawn()).to.equal(AMOUNTS[0]);
    await expectReconciled(vault);
  });

  it("M1 dispute then arbiter Release credits the provider, and the events carry the right args", async () => {
    const ctx = await loadFixture(activeFixture);
    const { vault, client, provider, arbiter } = ctx;
    await completeMilestone(ctx, 0);
    await vault.connect(client).approve(0, deliverableOf(0));

    const h = await completeMilestone(ctx, 1);
    await expect(vault.connect(client).dispute(1, evidenceOf(1)))
      .to.emit(vault, "MilestoneDisputed")
      .withArgs(1, evidenceOf(1));
    const disputed = await vault.getMilestone(1);
    expect(disputed.state).to.equal(MilestoneState.Disputed);
    expect(disputed.evidenceHash).to.equal(evidenceOf(1));
    expect(disputed.deliverableHash).to.equal(h);
    await expectReconciled(vault);

    await expect(vault.connect(arbiter).resolve(1, Ruling.Release, rationaleOf(1)))
      .to.emit(vault, "DisputeResolved")
      .withArgs(1, Ruling.Release, rationaleOf(1))
      .and.to.emit(vault, "Credited")
      .withArgs(provider.address, AMOUNTS[1]);
    const resolved = await vault.getMilestone(1);
    expect(resolved.state).to.equal(MilestoneState.Released);
    expect(resolved.rationaleHash).to.equal(rationaleOf(1));
    expect(await vault.credits(provider.address)).to.equal(AMOUNTS[0] + AMOUNTS[1]);
    await expectReconciled(vault);
  });

  it("M2 dispute then arbiter Refund credits the client, who withdraws it, and the agreement Closes", async () => {
    const ctx = await loadFixture(activeFixture);
    const { vault, client, provider, arbiter } = ctx;
    await completeMilestone(ctx, 0);
    await vault.connect(client).approve(0, deliverableOf(0));
    await completeMilestone(ctx, 1);
    await vault.connect(client).approve(1, deliverableOf(1));
    await completeMilestone(ctx, 2);
    await vault.connect(client).dispute(2, evidenceOf(2));

    await expect(vault.connect(arbiter).resolve(2, Ruling.Refund, rationaleOf(2)))
      .to.emit(vault, "DisputeResolved")
      .withArgs(2, Ruling.Refund, rationaleOf(2))
      .and.to.emit(vault, "Credited")
      .withArgs(client.address, AMOUNTS[2])
      .and.to.emit(vault, "AgreementClosed");
    expect((await vault.getMilestone(2)).state).to.equal(MilestoneState.Refunded);
    expect(await vault.agreementState()).to.equal(AgreementState.Closed);
    expect(await vault.credits(arbiter.address)).to.equal(0);
    await expectReconciled(vault);

    const before = await ethers.provider.getBalance(client.address);
    const wtx = await vault.connect(client).withdraw();
    const receipt = await wtx.wait();
    const after = await ethers.provider.getBalance(client.address);
    expect(after - before + receipt!.fee).to.equal(AMOUNTS[2]);

    await vault.connect(provider).withdraw(); // M0 + M1
    const r = await vault.reconcile();
    expect(r.ok).to.equal(true);
    expect(r.actualBalance).to.equal(0);
    expect(r.released).to.equal(AMOUNTS[0] + AMOUNTS[1]);
    expect(r.refunded).to.equal(AMOUNTS[2]);
    expect(r.withdrawn).to.equal(TOTAL);
    expect(r.owedToParties).to.equal(0);
  });

  it("closes the agreement after the last milestone and keeps withdrawals working in the Closed state", async () => {
    const ctx = await loadFixture(activeFixture);
    const { vault, client, provider } = ctx;
    for (let i = 0; i < 3; i++) {
      await completeMilestone(ctx, i);
      if (i < 2) {
        await vault.connect(client).approve(i, deliverableOf(i));
        expect(await vault.agreementState()).to.equal(AgreementState.Active);
      } else {
        await expect(vault.connect(client).approve(i, deliverableOf(i))).to.emit(vault, "AgreementClosed");
      }
    }
    expect(await vault.agreementState()).to.equal(AgreementState.Closed);
    await expectReconciled(vault);
    await expect(vault.connect(provider).withdraw()).to.emit(vault, "Withdrawn").withArgs(provider.address, TOTAL);
    await expectReconciled(vault);
  });

  it("lets the provider escalate after the review window, then the arbiter resolves", async () => {
    const ctx = await loadFixture(activeFixture);
    const { vault, provider, arbiter } = ctx;
    await completeMilestone(ctx, 0);
    await time.increase(REVIEW_WINDOW);

    await expect(vault.connect(provider).escalate(0)).to.emit(vault, "MilestoneEscalated").withArgs(0);
    const m = await vault.getMilestone(0);
    expect(m.state).to.equal(MilestoneState.Disputed);
    expect(m.evidenceHash).to.equal(ethers.ZeroHash);
    await expectReconciled(vault);

    await vault.connect(arbiter).resolve(0, Ruling.Release, rationaleOf(0));
    expect(await vault.credits(provider.address)).to.equal(AMOUNTS[0]);
    await expectReconciled(vault);
  });

  it("emits MilestoneCompleted with the committed deliverable hash and records completedAt", async () => {
    const { vault, provider } = await loadFixture(activeFixture);
    const tx = vault.connect(provider).markComplete(0, deliverableOf(0));
    await expect(tx).to.emit(vault, "MilestoneCompleted").withArgs(0, deliverableOf(0));
    const m = await vault.getMilestone(0);
    expect(m.state).to.equal(MilestoneState.Completed);
    expect(m.deliverableHash).to.equal(deliverableOf(0));
    expect(m.completedAt).to.equal(await time.latest());
  });

  it("keeps the books reconciled through the full happy path, step by step", async () => {
    const ctx = await loadFixture(activeFixture);
    const { vault, client, provider } = ctx;
    for (let i = 0; i < 3; i++) {
      await completeMilestone(ctx, i);
      await expectReconciled(vault);
      await vault.connect(client).approve(i, deliverableOf(i));
      await expectReconciled(vault);
      await vault.connect(provider).withdraw();
      await expectReconciled(vault);
    }
    expect((await vault.reconcile()).actualBalance).to.equal(0);
  });

  it("rejects every milestone action once the agreement is Closed", async () => {
    const ctx = await loadFixture(activeFixture);
    const { vault, client, provider, arbiter } = ctx;
    for (let i = 0; i < 3; i++) {
      await completeMilestone(ctx, i);
      await vault.connect(client).approve(i, deliverableOf(i));
    }
    const closed = AgreementState.Closed;
    await expect(vault.connect(provider).markComplete(0, deliverableOf(0)))
      .to.be.revertedWithCustomError(vault, "WrongAgreementState")
      .withArgs(closed);
    await expect(vault.connect(client).approve(0, deliverableOf(0)))
      .to.be.revertedWithCustomError(vault, "WrongAgreementState")
      .withArgs(closed);
    await expect(vault.connect(arbiter).resolve(0, Ruling.Refund, rationaleOf(0)))
      .to.be.revertedWithCustomError(vault, "WrongAgreementState")
      .withArgs(closed);
  });
});
