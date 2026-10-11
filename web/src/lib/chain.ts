import { Contract, JsonRpcProvider, type Signer } from "ethers";
import deployment from "../generated/deployment.json";
import { ForceSender, MilestoneVault, NaiveDrainer, NaiveEscrow, ReentrantProvider, RejectingProvider } from "../generated/contracts";
import { decodeRevert, makeInterface, type DecodedRevert, type NotARevert } from "./revert";

export { deployment };

/** staticNetwork: ethers must not keep retrying network detection (and flooding the console) when the chain is down. */
export const provider = new JsonRpcProvider(deployment.rpcUrl, deployment.chainId, { staticNetwork: true });

/** Every ABI the app may see a revert from (vault, attackers). */
export const revertInterface = makeInterface([MilestoneVault.abi, ReentrantProvider.abi, RejectingProvider.abi, NaiveEscrow.abi, NaiveDrainer.abi, ForceSender.abi]);

export const ACCOUNT_ROLES = ["client", "provider", "arbiter", "stranger"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const accountAddress = (role: AccountRole | "sandboxClient" | "sandboxProvider" | "sandboxArbiter"): string =>
  (deployment.accounts as Record<string, { address: string }>)[role].address;

/** Hardhat's unlocked accounts: no wallet, no MetaMask. */
export const signerAt = (address: string): Promise<Signer> => provider.getSigner(address);

export const vaultContract = (address: string, runner: Signer | JsonRpcProvider = provider): Contract =>
  new Contract(address, MilestoneVault.abi, runner);

export async function hasCode(address: string): Promise<boolean> {
  try {
    return (await provider.getCode(address)) !== "0x";
  } catch {
    return false;
  }
}

export function explain(err: unknown, role?: string): DecodedRevert | NotARevert {
  return decodeRevert(err, revertInterface, { role });
}
