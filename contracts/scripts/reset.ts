import { network } from "hardhat";
import { deployDemo } from "./deploy-demo";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";

/** Resets the running Hardhat node to genesis, then re-seeds the demo scenario. */
async function main(): Promise<void> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "hardhat_reset", params: [] }),
  });
  const body = (await res.json()) as { error?: { message: string } };
  if (body.error) throw new Error(`hardhat_reset failed: ${body.error.message}`);
  console.log(`hardhat_reset ok on ${RPC_URL} (network ${network.name})`);
  await deployDemo();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
