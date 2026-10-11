import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { MilestoneVault } from "../../typechain-types";

export const AMOUNTS = [ethers.parseEther("1"), ethers.parseEther("2.5"), ethers.parseEther("1.5")];
export const TOTAL = AMOUNTS.reduce((a, b) => a + b, 0n);
export const REVIEW_WINDOW = 3600;
export const AGREEMENT_HASH = ethers.keccak256(ethers.toUtf8Bytes("KrishiLens agreement v1"));

// Mirrors the Solidity enums (ethers returns them as bigint, errors/args accept numbers).
export const AgreementState = { AwaitingSignatures: 0, AwaitingFunding: 1, Active: 2, Closed: 3 } as const;
export const MilestoneState = { Pending: 0, Completed: 1, Disputed: 2, Released: 3, Refunded: 4 } as const;
export const Ruling = { Release: 0, Refund: 1 } as const;

/** SHA-256 of a UTF-8 string: how deliverables are hashed in the product. */
export const hashOf = (s: string): string => ethers.sha256(ethers.toUtf8Bytes(s));
export const deliverableOf = (i: number): string => hashOf(`deliverable-${i}`);
export const evidenceOf = (i: number): string => hashOf(`evidence-${i}`);
export const rationaleOf = (i: number): string => hashOf(`rationale-${i}`);

export interface Ctx {
  vault: MilestoneVault;
  client: HardhatEthersSigner;
  provider: HardhatEthersSigner;
  arbiter: HardhatEthersSigner;
  stranger: HardhatEthersSigner;
}

export async function deployVault(
  amounts: bigint[] = AMOUNTS,
  reviewWindow: number = REVIEW_WINDOW,
): Promise<Ctx> {
  const [client, provider, arbiter, stranger] = await ethers.getSigners();
  const vault = await ethers.deployContract("MilestoneVault", [
    client.address,
    provider.address,
    arbiter.address,
    AGREEMENT_HASH,
    amounts,
    reviewWindow,
  ]);
  return { vault, client, provider, arbiter, stranger };
}

/** AwaitingSignatures. */
export async function deployedFixture(): Promise<Ctx> {
  return deployVault();
}

/** AwaitingFunding (both parties signed). */
export async function signedFixture(): Promise<Ctx> {
  const ctx = await deployVault();
  await ctx.vault.connect(ctx.client).sign(AGREEMENT_HASH);
  await ctx.vault.connect(ctx.provider).sign(AGREEMENT_HASH);
  return ctx;
}

/** Active: funded with 5 ETH, milestones 1 / 2.5 / 1.5 ETH, review window 3600 s. */
export async function activeFixture(): Promise<Ctx> {
  const ctx = await signedFixture();
  await ctx.vault.connect(ctx.client).fund({ value: TOTAL });
  return ctx;
}

// ── Milestone steppers (each returns nothing; the vault is the source of truth) ──

export async function completeMilestone(ctx: Ctx, i: number): Promise<string> {
  const h = deliverableOf(i);
  await ctx.vault.connect(ctx.provider).markComplete(i, h);
  return h;
}

export async function approveMilestone(ctx: Ctx, i: number): Promise<void> {
  await completeMilestone(ctx, i);
  await ctx.vault.connect(ctx.client).approve(i, deliverableOf(i));
}

export async function disputeMilestone(ctx: Ctx, i: number): Promise<void> {
  await completeMilestone(ctx, i);
  await ctx.vault.connect(ctx.client).dispute(i, evidenceOf(i));
}

export async function refundMilestone(ctx: Ctx, i: number): Promise<void> {
  await disputeMilestone(ctx, i);
  await ctx.vault.connect(ctx.arbiter).resolve(i, Ruling.Refund, rationaleOf(i));
}

export async function releaseByArbiter(ctx: Ctx, i: number): Promise<void> {
  await disputeMilestone(ctx, i);
  await ctx.vault.connect(ctx.arbiter).resolve(i, Ruling.Release, rationaleOf(i));
}

// ── Named fixtures for M0 in each state (loadFixture needs stable function identities) ──

export const m0Pending = activeFixture;
export async function m0Completed(): Promise<Ctx> {
  const ctx = await activeFixture();
  await completeMilestone(ctx, 0);
  return ctx;
}
export async function m0Disputed(): Promise<Ctx> {
  const ctx = await activeFixture();
  await disputeMilestone(ctx, 0);
  return ctx;
}
export async function m0Released(): Promise<Ctx> {
  const ctx = await activeFixture();
  await approveMilestone(ctx, 0);
  return ctx;
}
export async function m0Refunded(): Promise<Ctx> {
  const ctx = await activeFixture();
  await refundMilestone(ctx, 0);
  return ctx;
}
/** M0 Completed and the review window has elapsed (escalation is allowed). */
export async function m0Escalatable(): Promise<Ctx> {
  const ctx = await m0Completed();
  await time.increase(REVIEW_WINDOW);
  return ctx;
}

export const m0FixtureByState = {
  Pending: m0Pending,
  Completed: m0Completed,
  Disputed: m0Disputed,
  Released: m0Released,
  Refunded: m0Refunded,
} as const;

/** Asserts the whole reconcile() struct is internally consistent and matches the real balance. */
export async function expectReconciled(vault: MilestoneVault): Promise<void> {
  const r = await vault.reconcile();
  const paidOut = r.released + r.refunded;
  expect(r.ok, "reconcile().ok").to.equal(true);
  expect(r.heldInEscrow, "I3: heldInEscrow == heldByMilestones").to.equal(r.heldByMilestones);
  expect(r.heldInEscrow, "heldInEscrow == deposited - released - refunded").to.equal(r.deposited - paidOut);
  expect(r.owedToParties, "I5: owed == released + refunded - withdrawn").to.equal(paidOut - r.withdrawn);
  expect(r.expectedBalance, "expected == deposited - withdrawn").to.equal(r.deposited - r.withdrawn);
  expect(r.actualBalance, "actual == real vault balance").to.equal(await ethers.provider.getBalance(await vault.getAddress()));
  expect(r.actualBalance, "actual == expected + surplus").to.equal(r.expectedBalance + r.surplus);
}

export { loadFixture, time };
