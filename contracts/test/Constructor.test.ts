import { expect } from "chai";
import { ethers } from "hardhat";
import { AGREEMENT_HASH, AMOUNTS, AgreementState, REVIEW_WINDOW, TOTAL } from "./helpers/fixtures";

describe("Constructor validation", () => {
  async function parties() {
    const [client, provider, arbiter] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("MilestoneVault");
    return { client: client.address, provider: provider.address, arbiter: arbiter.address, factory };
  }

  type Parties = Awaited<ReturnType<typeof parties>>;

  const deploy = (
    f: Parties,
    over: Partial<{ c: string; p: string; a: string; h: string; amounts: bigint[]; w: number }> = {},
  ) =>
    f.factory.deploy(
      over.c ?? f.client,
      over.p ?? f.provider,
      over.a ?? f.arbiter,
      over.h ?? AGREEMENT_HASH,
      over.amounts ?? AMOUNTS,
      over.w ?? REVIEW_WINDOW,
    );

  it("accepts a valid configuration and sets totalAmount to the sum of the milestone amounts", async () => {
    const f = await parties();
    const vault = await deploy(f);
    expect(await vault.client()).to.equal(f.client);
    expect(await vault.provider()).to.equal(f.provider);
    expect(await vault.arbiter()).to.equal(f.arbiter);
    expect(await vault.agreementHash()).to.equal(AGREEMENT_HASH);
    expect(await vault.reviewWindow()).to.equal(REVIEW_WINDOW);
    expect(await vault.totalAmount()).to.equal(TOTAL);
    expect(await vault.milestoneCount()).to.equal(AMOUNTS.length);
    expect(await vault.agreementState()).to.equal(AgreementState.AwaitingSignatures);
    expect(await vault.nextMilestone()).to.equal(0);
  });

  it("accepts the boundary sizes of 1 and 20 milestones", async () => {
    const f = await parties();
    expect(await (await deploy(f, { amounts: [1n] })).milestoneCount()).to.equal(1);
    const twenty = Array.from({ length: 20 }, () => 1n);
    const v = await deploy(f, { amounts: twenty });
    expect(await v.milestoneCount()).to.equal(20);
    expect(await v.totalAmount()).to.equal(20n);
  });

  it("rejects a zero address for each of the three parties", async () => {
    const f = await parties();
    const zero = ethers.ZeroAddress;
    await expect(deploy(f, { c: zero })).to.be.revertedWithCustomError(f.factory, "ZeroAddress");
    await expect(deploy(f, { p: zero })).to.be.revertedWithCustomError(f.factory, "ZeroAddress");
    await expect(deploy(f, { a: zero })).to.be.revertedWithCustomError(f.factory, "ZeroAddress");
  });

  it("rejects duplicate parties for all three pairs", async () => {
    const f = await parties();
    await expect(deploy(f, { p: f.client })).to.be.revertedWithCustomError(f.factory, "DuplicateParty");
    await expect(deploy(f, { a: f.client })).to.be.revertedWithCustomError(f.factory, "DuplicateParty");
    await expect(deploy(f, { a: f.provider })).to.be.revertedWithCustomError(f.factory, "DuplicateParty");
  });

  it("rejects 0 milestones and 21 milestones", async () => {
    const f = await parties();
    await expect(deploy(f, { amounts: [] }))
      .to.be.revertedWithCustomError(f.factory, "InvalidMilestoneCount")
      .withArgs(0);
    await expect(deploy(f, { amounts: Array.from({ length: 21 }, () => 1n) }))
      .to.be.revertedWithCustomError(f.factory, "InvalidMilestoneCount")
      .withArgs(21);
  });

  it("rejects a zero milestone amount and reports its index", async () => {
    const f = await parties();
    await expect(deploy(f, { amounts: [1n, 0n, 3n] }))
      .to.be.revertedWithCustomError(f.factory, "ZeroAmount")
      .withArgs(1);
  });

  it("rejects a zero agreement hash", async () => {
    const f = await parties();
    await expect(deploy(f, { h: ethers.ZeroHash })).to.be.revertedWithCustomError(f.factory, "ZeroHash");
  });

  it("rejects a zero review window", async () => {
    const f = await parties();
    await expect(deploy(f, { w: 0 })).to.be.revertedWithCustomError(f.factory, "InvalidReviewWindow");
  });

  it("reconciles at deployment: nothing deposited, nothing held, ok == true", async () => {
    const f = await parties();
    const vault = await deploy(f);
    const r = await vault.reconcile();
    expect(r.ok).to.equal(true);
    expect(r.deposited).to.equal(0);
    expect(r.heldByMilestones).to.equal(0);
    expect(r.actualBalance).to.equal(0);
  });

  it("reports an out-of-range milestone index with InvalidMilestone", async () => {
    const f = await parties();
    const vault = await deploy(f);
    await expect(vault.getMilestone(3)).to.be.revertedWithCustomError(vault, "InvalidMilestone").withArgs(3);
  });
});
