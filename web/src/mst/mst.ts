import { agreementHash, confirmedChecklistSchema, type ConfirmedChecklist } from "@mv/shared";
import { getAddress, isAddress } from "ethers";
import sample from "../../../samples/krishilens.confirmed.json";

/** MST testnet. Mainnet (chainId 4646) is deliberately not representable here. Defined in lib/mstNetwork.ts so the app and this page share it. */
export { MST } from "../lib/mstNetwork";

export type PartyCheck = { ok: true; provider: string; arbiter: string } | { ok: false; reason: string };

/** The three parties must be valid and distinct (the contract reverts DuplicateParty / ZeroAddress otherwise). */
export function checkParties(client: string, provider: string, arbiter: string): PartyCheck {
  if (!isAddress(client)) return { ok: false, reason: "Connect a wallet first." };
  if (!isAddress(provider)) return { ok: false, reason: "Provider is not a valid address." };
  if (!isAddress(arbiter)) return { ok: false, reason: "Arbiter is not a valid address." };
  const [c, p, a] = [getAddress(client), getAddress(provider), getAddress(arbiter)];
  if (c === p || c === a || p === a) return { ok: false, reason: "Client, provider and arbiter must be three different addresses." };
  return { ok: true, provider: p, arbiter: a };
}

/** The demo agreement with the three real parties substituted. Parsed through the schema, so it is a ConfirmedChecklist. */
export function buildChecklist(client: string, provider: string, arbiter: string): { confirmed: ConfirmedChecklist; hash: string } {
  const draft = structuredClone(sample) as ConfirmedChecklist;
  draft.parties.client.address = getAddress(client);
  draft.parties.provider.address = getAddress(provider);
  draft.parties.arbiter.address = getAddress(arbiter);
  const confirmed = confirmedChecklistSchema.parse(draft);
  return { confirmed, hash: agreementHash(confirmed) };
}
