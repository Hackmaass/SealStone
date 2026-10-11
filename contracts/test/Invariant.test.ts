import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { MilestoneVault } from "../typechain-types";
import { AGREEMENT_HASH, MilestoneState } from "./helpers/fixtures";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Randomized sequence test. A seeded PRNG drives hundreds of random calls from random actors against
// freshly deployed vaults. After EVERY step the invariants I1–I8 from docs/04-CONTRACT-SPEC.md are asserted,
// a failed call must leave storage byte-for-byte unchanged (I6), every revert must be one of the vault's own
// custom errors (no Panic, no empty revert), and every successful call must emit an event (no silent no-ops).
// Failures print the seed, step, actor and arguments so they can be replayed with `it.only`.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const SEEDS = [1, 2, 3, 42, 1337];
const STEPS = 200;
const ACTIONS = ["sign", "fund", "markComplete", "approve", "dispute", "escalate", "resolve", "withdraw"] as const;
type ActionName = (typeof ACTIONS)[number];
const ACTOR_NAMES = ["client", "provider", "arbiter", "stranger"] as const;

const TERMINAL = new Set<number>([MilestoneState.Released, MilestoneState.Refunded]);
// Legal single-step milestone moves (spec table). Staying put is always legal.
const LEGAL_MOVES = new Set<string>(["0>1", "1>2", "1>3", "2>3", "2>4"]);

/** Which role the spec says may call each function. Used as a "role check comes first" oracle. */
const ROLE_ERROR: Partial<Record<ActionName, { allowed: number[]; error: string }>> = {
  sign: { allowed: [0, 1], error: "NotSigner" },
  fund: { allowed: [0], error: "NotClient" },
  markComplete: { allowed: [1], error: "NotProvider" },
  approve: { allowed: [0], error: "NotClient" },
  dispute: { allowed: [0], error: "NotClient" },
  escalate: { allowed: [1], error: "NotProvider" },
  resolve: { allowed: [2], error: "NotArbiter" },
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface MilestoneSnap {
  amount: bigint;
  state: number;
  deliverableHash: string;
  evidenceHash: string;
  rationaleHash: string;
  completedAt: bigint;
}

interface Snap {
  agreementState: number;
  clientSigned: boolean;
  providerSigned: boolean;
  nextMilestone: bigint;
  deposited: bigint;
  released: bigint;
  refunded: bigint;
  withdrawn: bigint;
  credits: bigint[]; // client, provider, arbiter, stranger
  milestones: MilestoneSnap[];
  vaultBalance: bigint;
  rec: Record<string, bigint | boolean>;
}

const ser = (x: unknown): string => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

interface Action {
  name: ActionName;
  actor: number;
  args: unknown[];
  value?: bigint;
  advanceTime?: boolean;
}

interface Stats {
  perAction: Record<string, { succeeded: number; reverted: number }>;
  errors: Record<string, number>;
  steps: number;
  vaults: number;
}

const GLOBAL_SUCCESS: Record<string, number> = {};

describe("Randomized invariant test (seeded; I1–I8 hold after every step)", function () {
  let signers: HardhatEthersSigner[];
  let vaultInterface: MilestoneVault["interface"];

  before(async () => {
    signers = (await ethers.getSigners()).slice(0, 4);
    vaultInterface = (await ethers.getContractFactory("MilestoneVault")).interface as MilestoneVault["interface"];
  });

  /** Returns the decoded custom-error name of a failed call, or throws if it was a panic / unknown / empty. */
  function decodeRevert(e: unknown): string {
    const err = e as { data?: string; error?: { data?: string }; info?: { error?: { data?: string } } };
    const data = err.data ?? err.error?.data ?? err.info?.error?.data;
    if (typeof data !== "string" || data.length < 10) {
      throw new Error(`revert without decodable data (silent revert?): ${String(e)}`);
    }
    if (data.startsWith("0x4e487b71")) throw new Error(`Panic (arithmetic/assert) escaped: ${data}`);
    const parsed = vaultInterface.parseError(data);
    if (!parsed) throw new Error(`revert with an unknown selector ${data.slice(0, 10)}`);
    return parsed.name;
  }

  async function deployRandomVault(rng: () => number): Promise<{ vault: MilestoneVault; count: number; total: bigint; window: number }> {
    const count = 1 + Math.floor(rng() * 8);
    const amounts = Array.from({ length: count }, () => ethers.parseEther("0.1") * BigInt(1 + Math.floor(rng() * 30)));
    const window = 600 + Math.floor(rng() * 3000);
    const vault = await ethers.deployContract("MilestoneVault", [
      signers[0].address,
      signers[1].address,
      signers[2].address,
      AGREEMENT_HASH,
      amounts,
      window,
    ]);
    return { vault, count, total: amounts.reduce((a, b) => a + b, 0n), window };
  }

  async function takeSnap(vault: MilestoneVault, count: number): Promise<Snap> {
    const [agreementState, clientSigned, providerSigned, nextMilestone, deposited, released, refunded, withdrawn, rec, vaultBalance] =
      await Promise.all([
        vault.agreementState(),
        vault.clientSigned(),
        vault.providerSigned(),
        vault.nextMilestone(),
        vault.totalDeposited(),
        vault.totalReleased(),
        vault.totalRefunded(),
        vault.totalWithdrawn(),
        vault.reconcile(),
        ethers.provider.getBalance(await vault.getAddress()),
      ]);
    const credits = await Promise.all(signers.map((s) => vault.credits(s.address)));
    const raw = await Promise.all(Array.from({ length: count }, (_, i) => vault.getMilestone(i)));
    const milestones: MilestoneSnap[] = raw.map((m) => ({
      amount: m.amount,
      state: Number(m.state),
      deliverableHash: m.deliverableHash,
      evidenceHash: m.evidenceHash,
      rationaleHash: m.rationaleHash,
      completedAt: m.completedAt,
    }));
    return {
      agreementState: Number(agreementState),
      clientSigned,
      providerSigned,
      nextMilestone,
      deposited,
      released,
      refunded,
      withdrawn,
      credits,
      milestones,
      vaultBalance,
      rec: rec.toObject() as Record<string, bigint | boolean>,
    };
  }

  /** The generator: ~50% a call that is valid right now (right actor, right args), otherwise anything at all. */
  function chooseAction(rng: () => number, snap: Snap, total: bigint, count: number): Action {
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
    const randHash = (): string => ethers.hexlify(Uint8Array.from({ length: 32 }, () => Math.floor(rng() * 256)));

    const validAction = (): Action | null => {
      const holders = [0, 1].filter((i) => snap.credits[i] > 0n);
      if (holders.length > 0 && rng() < 0.4) return { name: "withdraw", actor: pick(holders), args: [] };
      switch (snap.agreementState) {
        case 0: {
          const who = [0, 1].filter((i) => (i === 0 ? !snap.clientSigned : !snap.providerSigned));
          return { name: "sign", actor: pick(who), args: [AGREEMENT_HASH] };
        }
        case 1:
          return { name: "fund", actor: 0, args: [], value: total };
        case 2: {
          const i = Number(snap.nextMilestone);
          const m = snap.milestones[i];
          if (m.state === MilestoneState.Pending) return { name: "markComplete", actor: 1, args: [i, randHash()] };
          if (m.state === MilestoneState.Completed) {
            const r = rng();
            if (r < 0.5) return { name: "approve", actor: 0, args: [i, m.deliverableHash] };
            if (r < 0.8) return { name: "dispute", actor: 0, args: [i, randHash()] };
            return { name: "escalate", actor: 1, args: [i], advanceTime: true };
          }
          if (m.state === MilestoneState.Disputed) {
            return { name: "resolve", actor: 2, args: [i, rng() < 0.5 ? 0 : 1, randHash()] };
          }
          break;
        }
        default:
          break;
      }
      return null;
    };

    if (rng() < 0.5) {
      const valid = validAction();
      if (valid) {
        // 30% of the time make it a near miss: one thing wrong, so the specific rule behind it is exercised.
        if (rng() < 0.3) {
          if (valid.name === "approve") valid.args = [valid.args[0], randHash()]; // swapped deliverable
          else if (valid.name === "markComplete") valid.args = rng() < 0.5 ? [Number(valid.args[0]) + 1, randHash()] : [valid.args[0], ethers.ZeroHash];
          else if (valid.name === "escalate") valid.advanceTime = false; // review window still open
          else if (valid.name === "fund") valid.value = total - 1n;
          else if (valid.name === "sign") valid.args = [randHash()];
          else if (valid.name === "resolve") valid.actor = 0;
        }
        return valid;
      }
    }

    // Fully random call; milestone indices span 0..count+1 so out-of-range indices are exercised too.
    const name = pick(ACTIONS);
    const actor = Math.floor(rng() * 4);
    const index = Math.floor(rng() * (count + 2));
    const knownHash = snap.milestones[Math.min(index, count - 1)]?.deliverableHash ?? randHash();
    const someHash = (): string => (rng() < 0.5 ? knownHash : rng() < 0.5 ? randHash() : AGREEMENT_HASH);
    switch (name) {
      case "sign":
        return { name, actor, args: [rng() < 0.7 ? AGREEMENT_HASH : randHash()] };
      case "fund":
        return { name, actor, args: [], value: rng() < 0.6 ? total : rng() < 0.5 ? 0n : total + BigInt(Math.floor(rng() * 1000)) - 500n };
      case "markComplete":
        return { name, actor, args: [index, rng() < 0.1 ? ethers.ZeroHash : randHash()] };
      case "approve":
        return { name, actor, args: [index, someHash()] };
      case "dispute":
        return { name, actor, args: [index, randHash()] };
      case "escalate":
        return { name, actor, args: [index], advanceTime: rng() < 0.5 };
      case "resolve":
        return { name, actor, args: [index, rng() < 0.5 ? 0 : 1, randHash()] };
      default:
        return { name: "withdraw", actor, args: [] };
    }
  }

  function assertInvariants(snap: Snap, total: bigint): void {
    const r = snap.rec as Record<string, bigint | boolean> & { ok: boolean };
    const sum = (state: number): bigint => snap.milestones.filter((m) => m.state === state).reduce((a, m) => a + m.amount, 0n);
    // I1: balance never below the books; equality because this test never force-sends ETH.
    expect(snap.vaultBalance, "I1 actual >= expected").to.be.gte(r.expectedBalance as bigint);
    expect(r.surplus, "I1 surplus == 0 (no forced ETH in this test)").to.equal(0n);
    expect(snap.vaultBalance, "I1 balance == reconcile().actualBalance").to.equal(r.actualBalance);
    expect(r.ok, "reconcile().ok").to.equal(true);
    // I2
    expect(snap.deposited === 0n || snap.deposited === total, `I2 deposited (${snap.deposited}) in {0, ${total}}`).to.equal(true);
    // I3
    expect(r.heldInEscrow, "I3 heldInEscrow == heldByMilestones").to.equal(r.heldByMilestones);
    // I4
    expect(snap.released, "I4 released == sum(Released)").to.equal(sum(MilestoneState.Released));
    expect(snap.refunded, "I4 refunded == sum(Refunded)").to.equal(sum(MilestoneState.Refunded));
    // I5
    expect(r.owedToParties, "I5 owed == released + refunded - withdrawn").to.equal(snap.released + snap.refunded - snap.withdrawn);
    expect(snap.credits[0] + snap.credits[1], "owed == credits[client] + credits[provider]").to.equal(r.owedToParties);
    // I7
    snap.milestones.forEach((m, i) => {
      if (BigInt(i) > snap.nextMilestone) expect(m.state, `I7 milestone ${i} beyond nextMilestone is Pending`).to.equal(MilestoneState.Pending);
    });
    // I8: only client and provider can ever hold credit
    expect(snap.credits[2], "I8 credits[arbiter] == 0").to.equal(0n);
    expect(snap.credits[3], "credits[stranger] == 0").to.equal(0n);
  }

  function assertMilestonesMovedLegally(prev: Snap, next: Snap): void {
    let changed = 0;
    next.milestones.forEach((m, i) => {
      const p = prev.milestones[i];
      if (TERMINAL.has(p.state)) expect(ser(m), `I6 terminal milestone ${i} never changes`).to.equal(ser(p));
      if (p.state !== m.state) {
        changed++;
        expect(LEGAL_MOVES.has(`${p.state}>${m.state}`), `legal move ${p.state}>${m.state} on milestone ${i}`).to.equal(true);
      }
    });
    expect(changed, "at most one milestone changes state per call").to.be.lte(1);
  }

  it("sanity: the revert decoder recognises a known revert and rejects non-custom ones", async () => {
    const { vault } = await deployRandomVault(mulberry32(7));
    let name = "";
    try {
      await vault.connect(signers[3]).fund({ value: 1n });
    } catch (e) {
      name = decodeRevert(e);
    }
    expect(name).to.equal("NotClient");
    expect(() => decodeRevert({ data: "0x4e487b710000000000000000000000000000000000000000000000000000000000000011" })).to.throw(/Panic/);
    expect(() => decodeRevert({ data: "0x" })).to.throw(/decodable/);
    expect(() => decodeRevert({ data: "0xdeadbeef00" })).to.throw(/unknown selector/);
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: ${STEPS} random steps keep every invariant (I1–I8), failed calls change nothing, reverts are custom errors`, async function () {
      this.timeout(1_800_000);
      const rng = mulberry32(seed);
      const stats: Stats = { perAction: {}, errors: {}, steps: 0, vaults: 0 };
      for (const a of ACTIONS) stats.perAction[a] = { succeeded: 0, reverted: 0 };

      let ctx = await deployRandomVault(rng);
      stats.vaults++;
      let snap = await takeSnap(ctx.vault, ctx.count);
      assertInvariants(snap, ctx.total);

      for (let step = 1; step <= STEPS; step++) {
        // A closed vault with nothing left to withdraw has nothing more to test: start a fresh one.
        if (snap.agreementState === 3 && snap.credits[0] === 0n && snap.credits[1] === 0n && rng() < 0.9) {
          ctx = await deployRandomVault(rng);
          stats.vaults++;
          snap = await takeSnap(ctx.vault, ctx.count);
        }

        const action = chooseAction(rng, snap, ctx.total, ctx.count);
        const label = `seed=${seed} step=${step} vault#${stats.vaults} action=${action.name} actor=${ACTOR_NAMES[action.actor]} args=${ser(action.args)} value=${action.value ?? 0n}`;
        try {
          if (action.advanceTime) await time.increase(ctx.window);
          const fn = (ctx.vault.connect(signers[action.actor]) as unknown as Record<string, (...a: unknown[]) => Promise<{ wait(): Promise<{ logs: unknown[] }> }>>)[action.name];
          let succeeded = false;
          let errName = "";
          try {
            const tx = await fn(...action.args, action.value !== undefined ? { value: action.value } : {});
            const receipt = await tx.wait();
            succeeded = true;
            expect(receipt.logs.length, "a successful call must emit at least one event (no silent no-op)").to.be.gte(1);
          } catch (e) {
            if (succeeded) throw e; // an assertion above failed; do not treat it as a revert
            errName = decodeRevert(e);
          }

          const next = await takeSnap(ctx.vault, ctx.count);
          if (succeeded) {
            stats.perAction[action.name].succeeded++;
            GLOBAL_SUCCESS[action.name] = (GLOBAL_SUCCESS[action.name] ?? 0) + 1;
            assertMilestonesMovedLegally(snap, next);
            if (action.name === "withdraw") {
              expect(next.withdrawn - snap.withdrawn, "withdraw pays exactly the caller's credit").to.equal(snap.credits[action.actor]);
              expect(next.credits[action.actor], "credit is zero after withdraw").to.equal(0n);
            }
          } else {
            stats.perAction[action.name].reverted++;
            stats.errors[errName] = (stats.errors[errName] ?? 0) + 1;
            expect(ser(next), "I6 a failed call changes no storage").to.equal(ser(snap));
            const role = ROLE_ERROR[action.name];
            if (role && !role.allowed.includes(action.actor)) {
              expect(errName, "role check is the first failing rule").to.equal(role.error);
            }
          }
          assertInvariants(next, ctx.total);
          snap = next;
          stats.steps++;
        } catch (e) {
          throw new Error(`INVARIANT FAILURE — replay with ${label}\n${(e as Error).message}`);
        }
      }

      const rows = ACTIONS.map((a) => ({ action: a, ...stats.perAction[a] }));
      const succeeded = rows.reduce((a, r) => a + r.succeeded, 0);
      const reverted = rows.reduce((a, r) => a + r.reverted, 0);
      console.log(`\n  seed ${seed}: ${stats.steps} steps, ${succeeded} succeeded, ${reverted} reverted, ${stats.vaults} vault(s)`);
      console.table(rows);
      console.log("  revert reasons:", JSON.stringify(stats.errors));

      expect(stats.steps).to.equal(STEPS);
      expect(succeeded, "the generator must produce real successful transitions").to.be.gte(STEPS * 0.25);
      expect(reverted, "the generator must also produce rejected calls").to.be.gte(STEPS * 0.15);
    });
  }

  after(() => {
    for (const a of ACTIONS) {
      expect(GLOBAL_SUCCESS[a] ?? 0, `across all seeds, "${a}" succeeded at least once`).to.be.gte(1);
    }
  });
});
