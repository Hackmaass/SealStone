import type { Contract } from "ethers";
import { provider, vaultContract, hasCode, revertInterface } from "./chain";
import { MILESTONE_NAMES, type MilestoneView, type Parties, type RawEvent, type ReconcileView } from "./vaultModel";

export interface VaultSnapshot {
  address: string;
  block: number;
  /** The chain's own clock, in seconds, as the NEXT block would see it. Never the laptop's clock. */
  chainNow: bigint;
  /** chainNow minus the laptop's clock at read time: add it to Date.now() to keep the chain's clock ticking between blocks. */
  clockOffset: number;
  addresses: { client: string; provider: string; arbiter: string };
  agreementHash: string;
  reviewWindow: bigint;
  total: bigint;
  agreementState: number;
  clientSigned: boolean;
  providerSigned: boolean;
  nextMilestone: number;
  milestones: MilestoneView[];
  credits: { client: bigint; provider: bigint };
  reconcile: ReconcileView;
  events: RawEvent[];
}

export type LoadResult = { kind: "missing" } | { kind: "ready"; snapshot: VaultSnapshot };

/** Cache of "who sent this transaction": a mined transaction never changes, so each is fetched once. */
const senders = new Map<string, string>();
export async function senderOf(txHash: string): Promise<string> {
  const hit = senders.get(txHash);
  if (hit) return hit;
  const tx = await provider.getTransaction(txHash);
  const from = tx?.from ?? "";
  if (from) senders.set(txHash, from);
  return from;
}
export const sendersSnapshot = (): Map<string, string> => new Map(senders);

async function chainClock(): Promise<bigint> {
  // Hardhat's "pending" block carries the timestamp the next block would get (wall clock + any evm_increaseTime offset).
  // ethers can't parse that block (its number is null), so read the raw timestamp.
  try {
    const pending = (await provider.send("eth_getBlockByNumber", ["pending", false])) as { timestamp?: string } | null;
    if (pending?.timestamp) return BigInt(pending.timestamp);
  } catch {
    /* fall through to latest */
  }
  const latest = await provider.getBlock("latest");
  return BigInt(latest?.timestamp ?? Math.floor(Date.now() / 1000));
}

const asReconcile = (r: Record<string, unknown>): ReconcileView => ({
  deposited: r.deposited as bigint,
  released: r.released as bigint,
  refunded: r.refunded as bigint,
  withdrawn: r.withdrawn as bigint,
  heldInEscrow: r.heldInEscrow as bigint,
  heldByMilestones: r.heldByMilestones as bigint,
  owedToParties: r.owedToParties as bigint,
  expectedBalance: r.expectedBalance as bigint,
  actualBalance: r.actualBalance as bigint,
  surplus: r.surplus as bigint,
  ok: r.ok as boolean,
});

async function readEvents(address: string): Promise<RawEvent[]> {
  const logs = await provider.getLogs({ address, fromBlock: 0, toBlock: "latest" });
  const out: RawEvent[] = [];
  for (const log of logs) {
    const parsed = revertInterface.parseLog(log);
    if (!parsed) continue;
    const args: Record<string, unknown> = {};
    parsed.fragment.inputs.forEach((input, i) => {
      args[input.name] = parsed.args[i];
    });
    out.push({ name: parsed.name, args, txHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.index });
  }
  return out;
}

/** Reads everything the vault screen shows in one pass. */
export async function loadVault(address: string): Promise<LoadResult> {
  if (!(await hasCode(address))) return { kind: "missing" };
  const v: Contract = vaultContract(address);
  const [block, chainNow, client, prov, arbiter, agreementHash, reviewWindow, total, agreementState, clientSigned, providerSigned, nextMilestone, count, rec, events] =
    await Promise.all([
      provider.getBlockNumber(),
      chainClock(),
      v.client(),
      v.provider(),
      v.arbiter(),
      v.agreementHash(),
      v.reviewWindow(),
      v.totalAmount(),
      v.agreementState(),
      v.clientSigned(),
      v.providerSigned(),
      v.nextMilestone(),
      v.milestoneCount(),
      v.reconcile(),
      readEvents(address),
    ]);
  const n = Number(count);
  const [rawMilestones, creditClient, creditProvider] = await Promise.all([
    Promise.all(Array.from({ length: n }, (_, i) => v.getMilestone(i))),
    v.credits(client),
    v.credits(prov),
  ]);
  const milestones: MilestoneView[] = rawMilestones.map((m, index) => ({
    index,
    amount: m.amount as bigint,
    state: MILESTONE_NAMES[Number(m.state)],
    deliverableHash: m.deliverableHash as string,
    evidenceHash: m.evidenceHash as string,
    rationaleHash: m.rationaleHash as string,
    completedAt: BigInt(m.completedAt),
  }));
  // Make sure every sender is cached before the page asks for them.
  await Promise.all([...new Set(events.map((e) => e.txHash))].map(senderOf));
  return {
    kind: "ready",
    snapshot: {
      address,
      block,
      chainNow,
      clockOffset: Number(chainNow) - Math.floor(Date.now() / 1000),
      addresses: { client, provider: prov, arbiter },
      agreementHash,
      reviewWindow: BigInt(reviewWindow),
      total,
      agreementState: Number(agreementState),
      clientSigned,
      providerSigned,
      nextMilestone: Number(nextMilestone),
      milestones,
      credits: { client: creditClient, provider: creditProvider },
      reconcile: asReconcile(rec),
      events,
    },
  };
}

export const partiesOf = (s: VaultSnapshot, names: { client: string; provider: string; arbiter: string }): Parties => ({
  client: { name: names.client, address: s.addresses.client },
  provider: { name: names.provider, address: s.addresses.provider },
  arbiter: { name: names.arbiter, address: s.addresses.arbiter },
});
