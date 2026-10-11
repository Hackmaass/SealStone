import { Contract, ContractFactory, type Signer } from "ethers";
import { agreementHash, type ConfirmedChecklist } from "@mv/shared";
import { MilestoneVault } from "../generated/contracts";

/**
 * THE TYPE BOUNDARY (docs/05): this is the only function that deploys an agreement, and it accepts only a
 * ConfirmedChecklist, i.e. the output of assertConfirmable() after a human resolved every ambiguity. It cannot
 * take a ProposedChecklist (see deploy.boundary.ts, which the compiler enforces). AI output never reaches the chain.
 */
export async function deployVault(
  confirmed: ConfirmedChecklist,
  hash: string,
  deployer: Signer,
): Promise<{ address: string; txHash: string }> {
  // The hash must be the hash of exactly this confirmed checklist, or nothing is deployed.
  if (agreementHash(confirmed) !== hash) throw new Error("The agreement hash does not match the confirmed terms. Nothing was deployed.");

  const { client, provider, arbiter } = confirmed.parties;
  const amounts = confirmed.milestones.map((m) => BigInt(m.amountWei));
  const factory = new ContractFactory(MilestoneVault.abi, MilestoneVault.bytecode, deployer);
  const contract = await factory.deploy(client.address, provider.address, arbiter.address, hash, amounts, BigInt(confirmed.reviewWindowSeconds));
  const receipt = await contract.deploymentTransaction()?.wait();
  await contract.waitForDeployment();

  // Read back what the chain actually stored.
  const address = await contract.getAddress();
  const reader = new Contract(address, MilestoneVault.abi, deployer);
  const onChainHash: string = await reader.agreementHash();
  const onChainTotal: bigint = await reader.totalAmount();
  if (onChainHash !== hash || onChainTotal !== amounts.reduce((a, b) => a + b, 0n)) {
    throw new Error("The deployed contract does not hold the confirmed terms. Do not use it.");
  }
  return { address, txHash: receipt?.hash ?? contract.deploymentTransaction()?.hash ?? "" };
}
