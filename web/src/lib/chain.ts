import { Contract, JsonRpcProvider, type Signer } from "ethers";
import deployment from "../generated/deployment.json";
import { ForceSender, MilestoneVault, NaiveDrainer, NaiveEscrow, ReentrantProvider, RejectingProvider } from "../generated/contracts";
import { decodeRevert, makeInterface, type DecodedRevert, type NotARevert } from "./revert";
import { MST } from "./mstNetwork";
import { NET } from "./network";
import { walletSigner } from "./wallet";

export { deployment };

/**
 * Where the app READS from. Local mode: the Hardhat node on this machine. Wallet mode: the public MST testnet RPC (it allows
 * cross-origin calls, so a hosted copy can read it straight from the browser, and nothing is read from 127.0.0.1).
 * staticNetwork: ethers must not keep retrying network detection (and flooding the console) when the chain is down.
 */
export const provider = NET === "wallet" ? new JsonRpcProvider(MST.rpc, MST.chainId, { staticNetwork: true }) : new JsonRpcProvider(deployment.rpcUrl, deployment.chainId, { staticNetwork: true });

/** Every ABI the app may see a revert from (vault, attackers). */
export const revertInterface = makeInterface([MilestoneVault.abi, ReentrantProvider.abi, RejectingProvider.abi, NaiveEscrow.abi, NaiveDrainer.abi, ForceSender.abi]);

export const ACCOUNT_ROLES = ["client", "provider", "arbiter", "stranger"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const accountAddress = (role: AccountRole | "sandboxClient" | "sandboxProvider" | "sandboxArbiter"): string =>
  (deployment.accounts as Record<string, { address: string }>)[role].address;

/**
 * Who signs. Local mode: Hardhat's unlocked accounts, no wallet, no MetaMask. Wallet mode: the visitor's own wallet, which opens
 * its own confirmation for every transaction, and only if it is on the account this action needs.
 */
export const signerAt = (address: string): Promise<Signer> => (NET === "wallet" ? walletSigner(address) : provider.getSigner(address));

export const vaultContract = (address: string, runner: Signer | JsonRpcProvider = provider): Contract =>
  new Contract(address, MilestoneVault.abi, runner);

export async function hasCode(address: string): Promise<boolean> {
  try {
    return (await provider.getCode(address)) !== "0x";
  } catch {
    return false;
  }
}

/**
 * Wallet mode only: the wallet's node and the public RPC this app reads from can be a block apart. After a transaction is
 * confirmed, wait (briefly) until reads can see its block, so the screen refreshes to the new state and not the old one.
 */
export async function readableAfter(receipt: unknown): Promise<void> {
  const n = (receipt as { blockNumber?: number } | null)?.blockNumber;
  if (!n || NET !== "wallet") return;
  for (let i = 0; i < 24; i++) {
    try {
      if ((await provider.getBlockNumber()) >= n) return;
    } catch {
      /* try again */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

export function explain(err: unknown, role?: string): DecodedRevert | NotARevert {
  return decodeRevert(err, revertInterface, { role });
}
