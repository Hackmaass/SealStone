import { expect } from "chai";
import { ethers } from "hardhat";

describe("MilestoneVault smoke test", () => {
  it("deploys, takes both signatures, is funded with 5 ETH and reconciles", async () => {
    const [client, provider, arbiter] = await ethers.getSigners();
    const agreementHash = ethers.keccak256(ethers.toUtf8Bytes("KrishiLens agreement"));
    const amounts = [ethers.parseEther("1"), ethers.parseEther("2.5"), ethers.parseEther("1.5")];

    const vault = await ethers.deployContract("MilestoneVault", [
      client.address,
      provider.address,
      arbiter.address,
      agreementHash,
      amounts,
      3600,
    ]);

    expect(await vault.totalAmount()).to.equal(ethers.parseEther("5"));

    await vault.connect(client).sign(agreementHash);
    await vault.connect(provider).sign(agreementHash);
    await vault.connect(client).fund({ value: ethers.parseEther("5") });

    const r = await vault.reconcile();
    expect(r.ok).to.equal(true);
    expect(r.deposited).to.equal(ethers.parseEther("5"));
    expect(r.actualBalance).to.equal(ethers.parseEther("5"));
    expect(r.heldByMilestones).to.equal(ethers.parseEther("5"));
  });
});
