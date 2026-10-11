import type { Signer } from "ethers";
import type { ProposedChecklist } from "@mv/shared";
import { deployVault } from "./deploy";

/**
 * Compile-time proof of the AI boundary. `tsc -b` fails if this line ever stops being an error, i.e. if
 * deployVault is ever changed to accept a ProposedChecklist.
 */
export function proposedCanNeverBeDeployed(proposed: ProposedChecklist, signer: Signer): Promise<unknown> {
  // @ts-expect-error a ProposedChecklist (AI output) is not assignable to a ConfirmedChecklist
  return deployVault(proposed, "0x", signer);
}
