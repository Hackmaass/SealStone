import { accountAddress, deployment, provider, vaultContract } from "./chain";
import { loadTerms } from "./terms";
import { MILESTONE_NAMES, type MilestoneView, type ReconcileView } from "./vaultModel";

/**
 * Finding the vaults that exist on this chain. There is no factory, so the chain itself is the registry: every vault is
 * a contract-creation transaction whose contract answers agreementHash() and milestoneCount(). Reading the chain (and not a
 * browser list) means the dashboard can never show a vault that a demo reset has removed, or miss one that exists.
 * The Attack Lab's throw-away sandbox vaults (client = sandbox account #4) are left out.
 */

export interface VaultSummary {
  address: string;
  title: string | null;
  agreementHash: string;
  parties: { client: string; provider: string; arbiter: string };
  names: { client: string; provider: string; arbiter: string } | null;
  agreementState: number;
  total: bigint;
  milestones: MilestoneView[];
  nextMilestone: number;
  credits: { client: bigint; provider: bigint };
  reconcile: ReconcileView;
  /** milestones that are Released or Refunded */
  settled: number;
  /** the block at which this vault was created (orders the list, newest first) */
  createdAt: number;
}

interface Found {
  address: string;
  block: number;
  client: string;
  isVault: boolean;
}

let cache: { epoch: string; scanned: number; found: Found[] } | null = null;
const SANDBOX_CLIENT = accountAddress("sandboxClient").toLowerCase();

type RawBlock = { transactions?: Array<{ hash: string; to: string | null }> } | null;

async function findCreations(): Promise<Found[]> {
  const latest = await provider.getBlockNumber();
  // A reset sends the block number backwards and redeploys at the same addresses: start over.
  if (!cache || cache.epoch !== deployment.generatedAt || latest < cache.scanned) cache = { epoch: deployment.generatedAt, scanned: -1, found: [] };
  const fresh = cache;
  for (let from = fresh.scanned + 1; from <= latest; from += 40) {
    const to = Math.min(latest, from + 39);
    const numbers = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const blocks = (await Promise.all(numbers.map((n) => provider.send("eth_getBlockByNumber", ["0x" + n.toString(16), true])))) as RawBlock[];
    const creations: Array<{ hash: string; block: number }> = [];
    blocks.forEach((b, i) => {
      for (const tx of b?.transactions ?? []) if (tx.to === null) creations.push({ hash: tx.hash, block: numbers[i] });
    });
    const receipts = await Promise.all(creations.map((c) => provider.getTransactionReceipt(c.hash)));
    for (let i = 0; i < creations.length; i++) {
      const address = receipts[i]?.contractAddress;
      if (!address) continue;
      try {
        const v = vaultContract(address);
        await Promise.all([v.agreementHash(), v.milestoneCount()]);
        const client = (await v.client()) as string;
        fresh.found.push({ address, block: creations[i].block, client, isVault: true });
      } catch {
        /* not a vault (an attack contract, the naive escrow, ...) */
      }
    }
  }
  fresh.scanned = latest;
  // A demo reset redeploys to the same addresses; an open page may still hold the earlier sighting. One entry per address, the newest wins.
  const byAddress = new Map<string, Found>();
  for (const f of fresh.found) if (f.isVault && f.client.toLowerCase() !== SANDBOX_CLIENT) byAddress.set(f.address.toLowerCase(), f);
  return [...byAddress.values()];
}

const titles = new Map<string, { title: string; names: VaultSummary["names"] } | null>();
async function termsFor(hash: string) {
  if (titles.has(hash)) return titles.get(hash)!;
  const t = await loadTerms(hash);
  const v = t.kind === "verified" ? { title: t.checklist.title, names: { client: t.checklist.parties.client.name, provider: t.checklist.parties.provider.name, arbiter: t.checklist.parties.arbiter.name } } : null;
  // do not remember "not found yet": the terms may be confirmed a moment later
  if (v) titles.set(hash, v);
  return v;
}

async function summarize(f: Found): Promise<VaultSummary | null> {
  try {
    const v = vaultContract(f.address);
    const [agreementHash, agreementState, total, nextMilestone, count, rec, client, prov, arbiter] = await Promise.all([
      v.agreementHash(), v.agreementState(), v.totalAmount(), v.nextMilestone(), v.milestoneCount(), v.reconcile(), v.client(), v.provider(), v.arbiter(),
    ]);
    const raw = await Promise.all(Array.from({ length: Number(count) }, (_, i) => v.getMilestone(i)));
    const [creditClient, creditProvider] = await Promise.all([v.credits(client), v.credits(prov)]);
    const milestones: MilestoneView[] = raw.map((m, index) => ({
      index, amount: m.amount as bigint, state: MILESTONE_NAMES[Number(m.state)], deliverableHash: m.deliverableHash, evidenceHash: m.evidenceHash, rationaleHash: m.rationaleHash, completedAt: BigInt(m.completedAt),
    }));
    const terms = await termsFor(agreementHash);
    return {
      address: f.address,
      title: terms?.title ?? null,
      agreementHash,
      parties: { client, provider: prov, arbiter },
      names: terms?.names ?? null,
      agreementState: Number(agreementState),
      total,
      milestones,
      nextMilestone: Number(nextMilestone),
      credits: { client: creditClient, provider: creditProvider },
      reconcile: {
        deposited: rec.deposited, released: rec.released, refunded: rec.refunded, withdrawn: rec.withdrawn, heldInEscrow: rec.heldInEscrow, heldByMilestones: rec.heldByMilestones,
        owedToParties: rec.owedToParties, expectedBalance: rec.expectedBalance, actualBalance: rec.actualBalance, surplus: rec.surplus, ok: rec.ok,
      },
      settled: milestones.filter((m) => m.state === "Released" || m.state === "Refunded").length,
      createdAt: f.block,
    };
  } catch {
    return null; // vanished mid-read (a reset); the next refresh drops it
  }
}

/** Every real vault on this chain, newest first, with the numbers the dashboard shows. */
export async function loadVaultSummaries(): Promise<VaultSummary[]> {
  const found = await findCreations();
  const all = await Promise.all(found.map(summarize));
  return all.filter((s): s is VaultSummary => s !== null).sort((a, b) => b.createdAt - a.createdAt);
}

export interface Totals {
  vaults: number;
  active: number;
  inEscrow: bigint;
  owed: bigint;
  allReconciled: boolean;
}

export function totalsOf(list: VaultSummary[]): Totals {
  return {
    vaults: list.length,
    active: list.filter((v) => v.agreementState === 2).length,
    inEscrow: list.reduce((s, v) => s + v.reconcile.heldInEscrow, 0n),
    owed: list.reduce((s, v) => s + v.reconcile.owedToParties, 0n),
    allReconciled: list.every((v) => v.reconcile.ok),
  };
}
