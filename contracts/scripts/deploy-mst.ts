import { ethers, network } from "hardhat";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
// Relative import on purpose: ts-node (CommonJS) can't compile TS from node_modules (CLAUDE.md).
import { agreementHash, confirmedChecklistSchema } from "../../shared/src/index";

const ROOT = path.resolve(__dirname, "../..");
const CONFIRMED_PATH = path.join(ROOT, "samples", "krishilens.confirmed.json");
const OUT_PATH = path.join(ROOT, "deployments", "mst-testnet.json");
const MST_CHAIN_ID = 91562037n;
const EXPLORER = "https://testnet.mstscan.com";

/**
 * Deploys ONE MilestoneVault to MST testnet. The TEAM runs this (it signs with DEPLOYER_KEY); nothing else is sent.
 * Deployer = client. PROVIDER_ADDRESS and ARBITER_ADDRESS (in .env) are the other two parties; they are written into the
 * confirmed checklist before hashing, so the on-chain agreementHash matches what the parties would sign.
 * It does not sign or fund: the vault stays in its initial state (no value moves).
 */
async function main(): Promise<void> {
  const net = await ethers.provider.getNetwork();
  if (net.chainId !== MST_CHAIN_ID) throw new Error(`expected MST testnet (${MST_CHAIN_ID}), got chainId ${net.chainId} (network ${network.name})`);

  const [deployer] = await ethers.getSigners();
  const provider = process.env.PROVIDER_ADDRESS;
  const arbiter = process.env.ARBITER_ADDRESS;
  if (!provider || !arbiter || !ethers.isAddress(provider) || !ethers.isAddress(arbiter)) {
    throw new Error("set PROVIDER_ADDRESS and ARBITER_ADDRESS (two distinct public addresses, not the deployer) in .env");
  }

  const confirmed = confirmedChecklistSchema.parse(JSON.parse(readFileSync(CONFIRMED_PATH, "utf8")));
  confirmed.parties.client.address = deployer.address;
  confirmed.parties.provider.address = ethers.getAddress(provider);
  confirmed.parties.arbiter.address = ethers.getAddress(arbiter);
  const hash = agreementHash(confirmedChecklistSchema.parse(confirmed));
  const amounts = confirmed.milestones.map((m) => BigInt(m.amountWei));

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`deployer ${deployer.address} balance ${ethers.formatEther(balance)} tMSTC`);
  if (balance === 0n) throw new Error("deployer has no tMSTC; use the faucet https://faucet.mstblockchain.com/");

  // Legacy (type 0) transaction with an explicit gasPrice: MST's fee estimation is unreliable with EIP-1559.
  const gasPrice = (await ethers.provider.getFeeData()).gasPrice ?? undefined;
  const vault = await ethers.deployContract(
    "MilestoneVault",
    [deployer.address, confirmed.parties.provider.address, confirmed.parties.arbiter.address, hash, amounts, confirmed.reviewWindowSeconds],
    { type: 0, gasPrice },
  );
  const tx = vault.deploymentTransaction();
  await vault.waitForDeployment();
  const address = await vault.getAddress();
  if ((await vault.agreementHash()) !== hash) throw new Error("on-chain agreementHash differs from the computed hash");

  const record = {
    network: "mst-testnet",
    chainId: Number(net.chainId),
    contract: "MilestoneVault",
    address,
    deployTx: tx?.hash ?? null,
    agreementHash: hash,
    parties: { client: deployer.address, provider: confirmed.parties.provider.address, arbiter: confirmed.parties.arbiter.address },
    explorer: { address: `${EXPLORER}/address/${address}`, tx: tx ? `${EXPLORER}/tx/${tx.hash}` : null },
    deployedAt: new Date().toISOString(),
  };
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(record, null, 2) + "\n");
  console.log(`MilestoneVault: ${address}\nagreementHash: ${hash}\n${record.explorer.address}\nrecorded in ${path.relative(ROOT, OUT_PATH)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
