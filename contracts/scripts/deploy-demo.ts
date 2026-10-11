import { ethers, network } from "hardhat";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
// Relative import on purpose: ts-node (CommonJS) can't compile TS from node_modules (CLAUDE.md).
import { agreementHash, canonicalJSON, confirmedChecklistSchema, fileSha256, textHash } from "../../shared/src/index";

const ROOT = path.resolve(__dirname, "../..");
const CONFIRMED_PATH = path.join(ROOT, "samples", "krishilens.confirmed.json");
const SOURCE_TEXT_PATH = path.join(ROOT, "samples", "agreements", "krishilens.txt");
const VECTOR_PATH = path.join(ROOT, "shared", "test", "vector.json");
const GENERATED_DIR = path.join(ROOT, "web", "src", "generated");
const AGREEMENTS_DIR = path.join(ROOT, "server", "data", "agreements");
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";

/** Hardhat account indexes used by the demo (docs/04, docs/08). */
const ROLE_INDEX = { client: 0, provider: 1, arbiter: 2, stranger: 3, sandboxClient: 4, sandboxProvider: 5, sandboxArbiter: 6 } as const;

export interface DeployResult {
  address: string;
  agreementHash: string;
  reconcileOk: boolean;
}

/** Deploys and seeds the KrishiLens demo vault. Exported so reset.ts can call it. */
export async function deployDemo(): Promise<DeployResult> {
  // 0. The ts-node/CommonJS path must hash exactly like vitest does.
  const vector = JSON.parse(readFileSync(VECTOR_PATH, "utf8"));
  if (agreementHash(vector.checklist) !== vector.hash) throw new Error("shared hash vector mismatch under ts-node");

  // 1. Load + validate the confirmed checklist (the only thing allowed on-chain) and hash it.
  const confirmed = confirmedChecklistSchema.parse(JSON.parse(readFileSync(CONFIRMED_PATH, "utf8")));
  const hash = agreementHash(confirmed);
  const sourceText = readFileSync(SOURCE_TEXT_PATH, "utf8").replace(/\r\n/g, "\n");
  if (textHash(sourceText) !== confirmed.extraction.sourceTextHash) {
    console.warn("WARNING: samples/agreements/krishilens.txt no longer matches extraction.sourceTextHash in the confirmed sample.");
  }

  // 2. Parties must be Hardhat accounts #0, #1, #2.
  const signers = await ethers.getSigners();
  const { client, provider, arbiter } = confirmed.parties;
  const expected = [client.address, provider.address, arbiter.address];
  expected.forEach((addr, i) => {
    if (signers[i].address !== addr) throw new Error(`confirmed checklist party #${i} (${addr}) is not Hardhat account #${i} (${signers[i].address})`);
  });

  // 3. Deploy, sign by both parties, fund, and have the provider mark M0 complete.
  const amounts = confirmed.milestones.map((m) => BigInt(m.amountWei));
  const total = amounts.reduce((a, b) => a + b, 0n);
  const vault = await ethers.deployContract("MilestoneVault", [client.address, provider.address, arbiter.address, hash, amounts, confirmed.reviewWindowSeconds], signers[0]);
  await vault.waitForDeployment();
  const address = await vault.getAddress();
  if ((await vault.agreementHash()) !== hash) throw new Error("on-chain agreementHash differs from the computed hash");

  await (await vault.connect(signers[0]).sign(hash)).wait();
  await (await vault.connect(signers[1]).sign(hash)).wait();
  await (await vault.connect(signers[0]).fund({ value: total })).wait();
  const m0Hash = await fileSha256(new TextEncoder().encode("m1-report.pdf (demo)"));
  await (await vault.connect(signers[1]).markComplete(0, m0Hash)).wait();

  const rec = await vault.reconcile();
  if (!rec.ok) throw new Error("seeded vault does not reconcile");

  // 4. Persist the confirmed JSON where "Verify agreement" can find it, and prove the round trip.
  mkdirSync(AGREEMENTS_DIR, { recursive: true });
  const saved = path.join(AGREEMENTS_DIR, `${hash}.json`);
  copyFileSync(CONFIRMED_PATH, saved);
  const reread = confirmedChecklistSchema.parse(JSON.parse(readFileSync(saved, "utf8")));
  if (agreementHash(reread) !== hash || canonicalJSON(reread) !== canonicalJSON(confirmed)) throw new Error("saved agreement does not re-hash to the on-chain hash");

  // 5. Deployment info for the web app.
  const net = await ethers.provider.getNetwork();
  const accounts = Object.fromEntries(Object.entries(ROLE_INDEX).map(([role, i]) => [role, { index: i, address: signers[i].address }]));
  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(
    path.join(GENERATED_DIR, "deployment.json"),
    JSON.stringify(
      {
        chainId: Number(net.chainId),
        rpcUrl: RPC_URL,
        accounts,
        preseededVault: { address, agreementHash: hash },
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );

  const result = { address, agreementHash: hash, reconcileOk: rec.ok };
  console.log(`Vault: ${address}`);
  console.log(`agreementHash: ${hash}`);
  console.log(`reconcile().ok: ${rec.ok}   (network ${network.name}, chainId ${net.chainId})`);
  return result;
}

if (require.main === module) {
  deployDemo().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
