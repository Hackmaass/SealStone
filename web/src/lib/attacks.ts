import { Contract, ContractFactory, keccak256, parseEther, toUtf8Bytes, type Signer } from "ethers";
import { ForceSender, MilestoneVault, NaiveDrainer, NaiveEscrow, ReentrantProvider } from "../generated/contracts";
import { accountAddress, explain, provider, revertInterface, signerAt, vaultContract } from "./chain";
import { formatRawError } from "./revert";
import { formatWei } from "../ui/copy";

/**
 * The Attack Lab engine. Every attack builds its OWN fresh sandbox vault (accounts #3 attacker, #4 client, #5 provider,
 * #6 arbiter), so each row is independent, "Run all" is repeatable, and the real demo vaults are never touched.
 * Nothing is simulated: every step is a real call, and a refusal is decoded from the node's own revert data.
 *
 * Three kinds of step are recorded:
 *   setup    must succeed (bringing the sandbox into the state the attack needs)
 *   attempt  the attack itself, with the outcome it is expected to have ("ok" or a custom error name)
 *   check    a condition read back from the chain afterwards (counters, balances, reconcile)
 */

export type Role = "client" | "provider" | "arbiter" | "attacker";
const ACCOUNT: Record<Role, Parameters<typeof accountAddress>[0]> = { client: "sandboxClient", provider: "sandboxProvider", arbiter: "sandboxArbiter", attacker: "stranger" };
export const ROLE_NAME: Record<Role, string> = { client: "Client", provider: "Provider", arbiter: "Arbiter", attacker: "Attacker" };

const eth = (n: number | string) => parseEther(String(n));
const H1 = keccak256(toUtf8Bytes("sealstone lab: report v1"));
const H2 = keccak256(toUtf8Bytes("sealstone lab: report v2 (swapped)"));
const EVIDENCE = keccak256(toUtf8Bytes("sealstone lab: evidence"));
const RATIONALE = keccak256(toUtf8Bytes("sealstone lab: rationale"));
const GAS = 3_000_000n; // explicit: gas estimation finds the MINIMUM gas, at which re-entries could fail by running out of gas instead of by the guard

type TxLike = { hash: string; wait: () => Promise<{ gasUsed: bigint } | null> };
type Send = (signer: Signer) => Promise<TxLike>;

export interface Step {
  kind: "setup" | "attempt" | "check";
  label: string;
  actor?: string;
  /** "Reverts: InvalidMilestoneState" or "Succeeds" */
  expected?: string;
  ok: boolean;
  /** attempts: what actually happened */
  actual?: string;
  mined?: boolean;
  txHash?: string;
  gasUsed?: bigint;
  revert?: { name: string; title: string; detail: string; raw: string };
  detail?: string;
}

export type Status = "pass" | "fail" | "error";

export interface AttackRun {
  id: string;
  /** pass: matched what was expected. fail: the contract did something else. error: the lab itself could not complete the run. */
  status: Status;
  steps: Step[];
  /** The plain-English answer shown in the table, with the raw error under it. */
  answer: { title: string; raw: string };
  vault: string | null;
  ledger: { ok: boolean | null; text: string };
  /** Wei drained (contrast row only). */
  drained?: bigint;
  error?: string;
  ms: number;
}

class LabError extends Error {}

class Sandbox {
  steps: Step[] = [];
  vault: string | null = null;
  summary: string | null = null;
  lastRevert: Step["revert"] | null = null;
  drained: bigint | undefined;
  private signers = new Map<Role, Signer>();

  async signer(role: Role): Promise<Signer> {
    let s = this.signers.get(role);
    if (!s) {
      s = await signerAt(accountAddress(ACCOUNT[role]));
      this.signers.set(role, s);
    }
    return s;
  }

  vaultAs(signer: Signer): Contract {
    if (!this.vault) throw new LabError("The sandbox vault does not exist yet");
    return vaultContract(this.vault, signer);
  }

  /** Must succeed. If it does not, the RUN is an error (the lab could not set the scene), never a pass. */
  async setup(label: string, role: Role, send: Send): Promise<void> {
    try {
      const tx = await send(await this.signer(role));
      const r = await tx.wait();
      this.steps.push({ kind: "setup", label, actor: ROLE_NAME[role], ok: true, mined: true, txHash: tx.hash, gasUsed: r?.gasUsed });
    } catch (e) {
      this.steps.push({ kind: "setup", label, actor: ROLE_NAME[role], ok: false, actual: (e as Error).message.slice(0, 160) });
      throw new LabError(`Setup failed: ${label}`);
    }
  }

  /** The attack. Resolves to whether the outcome matched `expect` ("ok" or a custom error name). */
  async attempt(label: string, role: Role, expect: "ok" | string, send: Send): Promise<boolean> {
    const expected = expect === "ok" ? "Succeeds" : `Reverts: ${expect}`;
    const actor = ROLE_NAME[role];
    try {
      const tx = await send(await this.signer(role));
      const r = await tx.wait();
      const ok = expect === "ok";
      this.steps.push({ kind: "attempt", label, actor, expected, ok, actual: "Succeeded", mined: true, txHash: tx.hash, gasUsed: r?.gasUsed });
      return ok;
    } catch (e) {
      const d = explain(e, ROLE_NAME[role].toLowerCase());
      if (!d.reverted) throw new LabError(`${label}: the call failed without a contract revert (${d.message.slice(0, 120)})`);
      const revert = { name: d.name, title: d.title, detail: d.detail, raw: formatRawError(d) };
      this.lastRevert = revert;
      const ok = expect === d.name;
      this.steps.push({ kind: "attempt", label, actor, expected, ok, actual: `Reverted: ${d.name}`, mined: false, revert });
      return ok;
    }
  }

  check(label: string, ok: boolean, detail: string): boolean {
    this.steps.push({ kind: "check", label, ok, detail });
    return ok;
  }
}

interface Opts {
  providerAddress?: string;
  sign: boolean;
  fund: boolean;
  /** A provider that is a contract cannot sign directly: these steps wire it up and have it sign through itself. */
  providerSteps?: (agreementHash: string) => Array<[label: string, role: Role, send: Send]>;
}

/** A brand-new 3 milestone (1 ETH each) vault with a 120 s review window, deployed by the sandbox client. */
async function makeVault(c: Sandbox, o: Opts): Promise<void> {
  const client = accountAddress(ACCOUNT.client);
  const providerAddr = o.providerAddress ?? accountAddress(ACCOUNT.provider);
  const arbiter = accountAddress(ACCOUNT.arbiter);
  const agreementHash = keccak256(toUtf8Bytes(`sealstone lab sandbox ${Date.now()} ${Math.random()}`));
  await c.setup("Deploy a fresh sandbox vault (3 milestones, 1 ETH each)", "client", async (s) => {
    const factory = new ContractFactory(MilestoneVault.abi, MilestoneVault.bytecode, s);
    const v = await factory.deploy(client, providerAddr, arbiter, agreementHash, [eth(1), eth(1), eth(1)], 120n);
    await v.waitForDeployment();
    c.vault = await v.getAddress();
    const t = v.deploymentTransaction()!;
    return { hash: t.hash, wait: async () => t.wait() };
  });
  if (o.sign) {
    await c.setup("Client signs the agreement hash", "client", (s) => c.vaultAs(s).sign(agreementHash));
    if (o.providerSteps) for (const [label, role, send] of o.providerSteps(agreementHash)) await c.setup(label, role, send);
    else await c.setup("Provider signs the agreement hash", "provider", (s) => c.vaultAs(s).sign(agreementHash));
  }
  if (o.fund) await c.setup("Client funds the escrow with 3 ETH", "client", (s) => c.vaultAs(s).fund({ value: eth(3) }));
}

const submitM0 = (c: Sandbox) => c.setup("Provider marks milestone 1 complete", "provider", (s) => c.vaultAs(s).markComplete(0, H1));
const creditOf = async (c: Sandbox, address: string): Promise<bigint> => (await vaultContract(c.vault!).credits(address)) as bigint;
const addr = (role: Role): string => accountAddress(ACCOUNT[role]);

export interface AttackDef {
  id: string;
  title: string;
  /** One plain sentence: what the attacker tries. */
  tries: string;
  attacker: string;
  /** Booklet requirement ids this covers (docs/01). */
  requirement: string;
  /** True for the four attacks the booklet requires by name. */
  booklet: boolean;
  /** Test names (literal strings from contracts/test) that prove the same guarantee. */
  tests: string[];
  /** Verdict word when the attack is stopped. */
  word: "Blocked" | "Absorbed";
  contrast?: boolean;
  run: (c: Sandbox) => Promise<void>;
}

const T = {
  second: "rejects a second release attempt",
  refund: "rejects an unauthorized refund",
  order: "rejects an out-of-order transition",
  reentrancy: "blocks a re-entrancy attack",
  swapped: "rejects approval of a swapped deliverable",
  roles: "Access control (every function rejects every role that is not allowed to call it)",
  machine: "State machine (only the transitions in the spec's table succeed; everything else reverts)",
  fundLess: "rejects wrong funding amounts (both less and more)",
  fundTwice: "rejects funding twice",
  direct: "rejects direct ETH transfers, with or without calldata",
  force: "keeps the books reconciled and the surplus visible when ETH is force-sent to the vault",
  forceWithdraw: "force-sent ETH is reported as surplus and cannot be withdrawn",
  early: "rejects early escalation until the review window has elapsed (ReviewWindowOpen with the right timestamp)",
  nothing: "rejects withdraw with no credit",
  naive: "naive escrow is drained by the same attack pattern (contrast)",
} as const;

const REENTRANCY_ERROR = "ReentrancyGuardReentrantCall";

export const ATTACKS: AttackDef[] = [
  {
    id: "second-release",
    title: "Release the same milestone twice",
    tries: "The client approves milestone 1, then approves it again to be paid twice.",
    attacker: "Client",
    requirement: "R10 · R13",
    booklet: true,
    tests: [T.second],
    word: "Blocked",
    async run(c) {
      await makeVault(c, { sign: true, fund: true });
      await submitM0(c);
      await c.setup("Client approves milestone 1 (the legitimate release)", "client", (s) => c.vaultAs(s).approve(0, H1));
      await c.attempt("Client approves milestone 1 a second time", "client", "InvalidMilestoneState", (s) => c.vaultAs(s).approve(0, H1));
      const owed = await creditOf(c, addr("provider"));
      c.check("The provider was credited exactly once", owed === eth(1), `credit ${formatWei(owed)} ETH, expected 1.000 ETH`);
    },
  },
  {
    id: "unauthorized-refund",
    title: "Refund without being the arbiter",
    tries: "A dispute is open. The client, then a stranger, try to order a refund themselves.",
    attacker: "Client, then a stranger",
    requirement: "R11 · R13",
    booklet: true,
    tests: [T.refund],
    word: "Blocked",
    async run(c) {
      await makeVault(c, { sign: true, fund: true });
      await submitM0(c);
      await c.setup("Client disputes milestone 1", "client", (s) => c.vaultAs(s).dispute(0, EVIDENCE));
      await c.attempt("Client orders a refund", "client", "NotArbiter", (s) => c.vaultAs(s).resolve(0, 1, RATIONALE));
      await c.attempt("A stranger orders a refund", "attacker", "NotArbiter", (s) => c.vaultAs(s).resolve(0, 1, RATIONALE));
      const owed = await creditOf(c, addr("client"));
      c.check("The client was not refunded", owed === 0n, `client credit ${formatWei(owed)} ETH`);
    },
  },
  {
    id: "out-of-order",
    title: "Act out of order",
    tries: "The client approves work that was never submitted, and the provider jumps ahead to milestone 2.",
    attacker: "Client, then provider",
    requirement: "R9 · R13",
    booklet: true,
    tests: [T.order],
    word: "Blocked",
    async run(c) {
      await makeVault(c, { sign: true, fund: true });
      await c.attempt("Client approves milestone 1 before it is submitted", "client", "InvalidMilestoneState", (s) => c.vaultAs(s).approve(0, H1));
      await submitM0(c);
      await c.attempt("Provider marks milestone 2 complete while milestone 1 is still open", "provider", "MilestoneOutOfOrder", (s) => c.vaultAs(s).markComplete(1, H1));
    },
  },
  {
    id: "reentrancy",
    title: "Re-enter withdraw from a malicious contract",
    tries: "The provider is a contract. When it is paid, it calls withdraw again from inside its own payment, hoping to be paid twice.",
    attacker: "Attacker contract (as the provider)",
    requirement: "R12 · R13",
    booklet: true,
    tests: [T.reentrancy],
    word: "Blocked",
    async run(c) {
      let rpAddress = "";
      await c.setup("Deploy the malicious provider contract", "attacker", async (s) => {
        const rp = await new ContractFactory(ReentrantProvider.abi, ReentrantProvider.bytecode, s).deploy();
        await rp.waitForDeployment();
        rpAddress = await rp.getAddress();
        const t = rp.deploymentTransaction()!;
        return { hash: t.hash, wait: async () => t.wait() };
      });
      const rp = (s: Signer | typeof provider) => new Contract(rpAddress, ReentrantProvider.abi, s);
      await makeVault(c, {
        providerAddress: rpAddress,
        sign: true,
        fund: true,
        providerSteps: (hash) => [
          ["Point the attacker contract at the vault", "attacker", (s) => rp(s as Signer).setVault(c.vault!)],
          ["The attacker contract signs the agreement hash", "attacker", (s) => rp(s as Signer).sign(hash)],
        ],
      });
      await c.setup("The attacker contract submits milestone 1", "attacker", (s) => rp(s).markComplete(0, H1));
      await c.setup("Client approves milestone 1 (1 ETH is now owed to the attacker contract)", "client", (s) => c.vaultAs(s).approve(0, H1));
      await c.attempt("The attacker contract withdraws and re-enters", "attacker", "ok", (s) => rp(s).attackWithdraw({ gasLimit: GAS }));

      const r = rp(provider);
      const attempts = (await r.reentryAttempts()) as bigint;
      const blocked = (await r.reentryBlocked()) as bigint;
      const succeeded = (await r.reentrySucceeded()) as bigint;
      const selector = (await r.lastRevertSelector()) as string;
      const guard = revertInterface.parseError(selector)?.name ?? `unknown ${selector}`;
      const received = await provider.getBalance(rpAddress);
      const stillOwed = await creditOf(c, rpAddress);
      c.check("The vault was re-entered at least once", attempts >= 1n, `${attempts} re-entry attempts`);
      c.check("Every re-entry was stopped", blocked === attempts && succeeded === 0n, `${blocked} blocked, ${succeeded} succeeded`);
      c.check("They were stopped by the re-entrancy guard (not by running out of gas)", guard === REENTRANCY_ERROR, `last refusal: ${guard}`);
      c.check("The attacker received exactly what it was owed", received === eth(1), `received ${formatWei(received)} ETH, owed 1.000 ETH`);
      c.check("Nothing is left owed to the attacker", stillOwed === 0n, `credit ${formatWei(stillOwed)} ETH`);
      c.summary = `${attempts} re-entries tried, ${blocked} blocked, ${succeeded} succeeded. It was paid exactly ${formatWei(received)} ETH, the amount owed.`;
    },
  },
  {
    id: "swapped-deliverable",
    title: "Approve a swapped deliverable",
    tries: "The provider submitted one file. The client tries to approve a different one.",
    attacker: "Client",
    requirement: "R5",
    booklet: false,
    tests: [T.swapped],
    word: "Blocked",
    async run(c) {
      await makeVault(c, { sign: true, fund: true });
      await submitM0(c);
      await c.attempt("Client approves with a different file's hash", "client", "DeliverableHashMismatch", (s) => c.vaultAs(s).approve(0, H2));
    },
  },
  {
    id: "provider-approves",
    title: "Provider approves their own work",
    tries: "The provider submits milestone 1 and then approves it themselves.",
    attacker: "Provider",
    requirement: "R8",
    booklet: false,
    tests: [T.roles],
    word: "Blocked",
    async run(c) {
      await makeVault(c, { sign: true, fund: true });
      await submitM0(c);
      await c.attempt("Provider approves milestone 1", "provider", "NotClient", (s) => c.vaultAs(s).approve(0, H1));
    },
  },
  {
    id: "arbiter-undisputed",
    title: "Arbiter rules on a milestone nobody disputed",
    tries: "The arbiter tries to settle a milestone that is simply awaiting the client's review.",
    attacker: "Arbiter",
    requirement: "R9 · R11",
    booklet: false,
    tests: [T.machine],
    word: "Blocked",
    async run(c) {
      await makeVault(c, { sign: true, fund: true });
      await submitM0(c);
      await c.attempt("Arbiter releases the milestone without a dispute", "arbiter", "InvalidMilestoneState", (s) => c.vaultAs(s).resolve(0, 0, RATIONALE));
    },
  },
  {
    id: "wrong-funding",
    title: "Fund the wrong amount, or fund twice",
    tries: "The client sends less than the total, then funds correctly, then tries to fund a second time.",
    attacker: "Client",
    requirement: "R12",
    booklet: false,
    tests: [T.fundLess, T.fundTwice],
    word: "Blocked",
    async run(c) {
      await makeVault(c, { sign: true, fund: false });
      await c.attempt("Client funds 2 ETH instead of 3 ETH", "client", "WrongFundingAmount", (s) => c.vaultAs(s).fund({ value: eth(2) }));
      await c.attempt("Client funds the exact 3 ETH (allowed)", "client", "ok", (s) => c.vaultAs(s).fund({ value: eth(3) }));
      await c.attempt("Client funds a second time", "client", "WrongAgreementState", (s) => c.vaultAs(s).fund({ value: eth(3) }));
    },
  },
  {
    id: "direct-payment",
    title: "Send ETH straight to the vault",
    tries: "A stranger sends money to the vault's address instead of using Fund escrow.",
    attacker: "Stranger",
    requirement: "R12",
    booklet: false,
    tests: [T.direct],
    word: "Blocked",
    async run(c) {
      await makeVault(c, { sign: true, fund: true });
      await c.attempt("Stranger sends 1 ETH directly to the vault", "attacker", "DirectPaymentNotAccepted", (s) => s.sendTransaction({ to: c.vault!, value: eth(1) }));
    },
  },
  {
    id: "force-send",
    title: "Force ETH in with selfdestruct",
    tries: "A contract self-destructs into the vault, pushing in 0.3 ETH that the vault cannot refuse, hoping to break its books.",
    attacker: "Stranger",
    requirement: "R12",
    booklet: false,
    tests: [T.force, T.forceWithdraw],
    word: "Absorbed",
    async run(c) {
      await makeVault(c, { sign: true, fund: true });
      let fsAddress = "";
      await c.setup("Deploy a self-destructing contract holding 0.3 ETH", "attacker", async (s) => {
        const f = await new ContractFactory(ForceSender.abi, ForceSender.bytecode, s).deploy({ value: eth("0.3") });
        await f.waitForDeployment();
        fsAddress = await f.getAddress();
        const t = f.deploymentTransaction()!;
        return { hash: t.hash, wait: async () => t.wait() };
      });
      await c.attempt("The contract self-destructs into the vault", "attacker", "ok", (s) => new Contract(fsAddress, ForceSender.abi, s).boom(c.vault!));
      const rec = await vaultContract(c.vault!).reconcile();
      c.check("The extra ETH is reported as surplus, exactly 0.300 ETH", (rec.surplus as bigint) === eth("0.3"), `surplus ${formatWei(rec.surplus as bigint)} ETH`);
      c.check("The books still reconcile", rec.ok === true, rec.ok ? "reconcile().ok = true" : "reconcile().ok = false");
      await c.attempt("The attacker tries to withdraw the surplus", "attacker", "NothingToWithdraw", (s) => c.vaultAs(s).withdraw());
      c.summary = "0.300 ETH counted as surplus. Nobody can withdraw it, and the books still balance.";
    },
  },
  {
    id: "early-escalation",
    title: "Escalate before the review window ends",
    tries: "The provider tries to push a milestone to the arbiter while the client still has time to review it.",
    attacker: "Provider",
    requirement: "R9",
    booklet: false,
    tests: [T.early],
    word: "Blocked",
    async run(c) {
      await makeVault(c, { sign: true, fund: true });
      await submitM0(c);
      await c.attempt("Provider escalates immediately", "provider", "ReviewWindowOpen", (s) => c.vaultAs(s).escalate(0));
    },
  },
  {
    id: "withdraw-nothing",
    title: "Withdraw with nothing owed",
    tries: "A stranger calls withdraw although the vault owes them nothing.",
    attacker: "Stranger",
    requirement: "R10",
    booklet: false,
    tests: [T.nothing],
    word: "Blocked",
    async run(c) {
      await makeVault(c, { sign: true, fund: true });
      await c.attempt("Stranger withdraws", "attacker", "NothingToWithdraw", (s) => c.vaultAs(s).withdraw());
    },
  },
];

/** The contrast: the SAME re-entrancy pattern against an escrow written without the protections. It is supposed to succeed. */
export const CONTRAST: AttackDef = {
  id: "naive-contrast",
  title: "The same re-entrancy attack against a naive escrow",
  tries: "An escrow that pays before it updates its books, with no guard, is attacked the same way.",
  attacker: "Attacker contract",
  requirement: "R13 (why the test matters)",
  booklet: false,
  tests: [T.naive],
  word: "Blocked",
  contrast: true,
  async run(c) {
    let escrowAddress = "";
    let drainerAddress = "";
    await c.setup("Deploy a naive escrow (no guard, pays before it updates)", "attacker", async (s) => {
      const e = await new ContractFactory(NaiveEscrow.abi, NaiveEscrow.bytecode, s).deploy();
      await e.waitForDeployment();
      escrowAddress = await e.getAddress();
      const t = e.deploymentTransaction()!;
      return { hash: t.hash, wait: async () => t.wait() };
    });
    const escrow = (s: Signer) => new Contract(escrowAddress, NaiveEscrow.abi, s);
    for (const payee of ["provider", "arbiter", "client"] as const) {
      await c.setup(`Deposit 1 ETH of another user's money (for the ${payee})`, "client", (s) => escrow(s).deposit(accountAddress(ACCOUNT[payee]), { value: eth(1) }));
    }
    await c.setup("Deploy the attacker contract", "attacker", async (s) => {
      const d = await new ContractFactory(NaiveDrainer.abi, NaiveDrainer.bytecode, s).deploy(escrowAddress);
      await d.waitForDeployment();
      drainerAddress = await d.getAddress();
      const t = d.deploymentTransaction()!;
      return { hash: t.hash, wait: async () => t.wait() };
    });
    await c.setup("The attacker deposits its own 1 ETH", "attacker", (s) => escrow(s).deposit(drainerAddress, { value: eth(1) }));
    const others = eth(3);
    await c.attempt("The attacker contract withdraws and re-enters", "attacker", "ok", (s) => new Contract(drainerAddress, NaiveDrainer.abi, s).attack({ gasLimit: GAS }));
    const left = await provider.getBalance(escrowAddress);
    const got = await provider.getBalance(drainerAddress);
    const stolen = got > eth(1) ? got - eth(1) : 0n;
    c.drained = stolen;
    const shortfall = others > left ? others - left : 0n;
    c.check("The naive escrow was drained of other users' money", stolen === others && left === 0n, `escrow holds ${formatWei(left)} ETH, ${formatWei(stolen)} ETH of other users' money was stolen`);
    c.summary = `Drained ${formatWei(stolen)} ETH that belonged to other users. ${formatWei(shortfall)} ETH short.`;
  },
};

export const ALL_ATTACKS: AttackDef[] = [...ATTACKS, CONTRAST];

/** Runs one attack end to end and classifies it. Never throws. */
export async function runAttack(def: AttackDef): Promise<AttackRun> {
  const started = Date.now();
  const c = new Sandbox();
  let error: string | undefined;
  try {
    await def.run(c);
  } catch (e) {
    error = e instanceof LabError ? e.message : `The lab could not complete this attack: ${(e as Error).message.slice(0, 160)}`;
  }
  const judged = c.steps.filter((s) => s.kind !== "setup");
  const allOk = judged.length > 0 && judged.every((s) => s.ok);
  const status: Status = error ? "error" : allOk ? "pass" : "fail";

  let ledger: AttackRun["ledger"] = { ok: null, text: "—" };
  if (def.contrast) {
    ledger = status === "pass" ? { ok: false, text: `✕ short ${formatWei(c.drained ?? 0n)}` } : { ok: null, text: "—" };
  } else if (c.vault) {
    try {
      const r = await vaultContract(c.vault).reconcile();
      ledger = r.ok ? { ok: true, text: "✓ reconciled" } : { ok: false, text: "✕ does not reconcile" };
    } catch {
      ledger = { ok: null, text: "?" };
    }
  }

  const last = c.lastRevert;
  const answer = c.summary ? { title: c.summary, raw: last ? last.raw : "" } : last ? { title: last.title, raw: last.raw } : { title: error ?? "—", raw: "" };
  return { id: def.id, status, steps: c.steps, answer, vault: c.vault, ledger, drained: c.drained, error, ms: Date.now() - started };
}

// ───────────────────────── scoring (pure) ─────────────────────────

export interface Score {
  total: number;
  blocked: number;
  failed: number;
  errored: number;
  notRun: number;
  ledgersOk: number;
  contrastDrained: bigint | null;
}

/** Computed from the actual results, never hard-coded. The contrast row is reported separately, not counted as a block. */
export function scoreOf(runs: Record<string, AttackRun | undefined>, defs: AttackDef[] = ALL_ATTACKS): Score {
  const attacks = defs.filter((d) => !d.contrast);
  const contrast = defs.find((d) => d.contrast);
  let blocked = 0;
  let failed = 0;
  let errored = 0;
  let notRun = 0;
  let ledgersOk = 0;
  for (const d of attacks) {
    const r = runs[d.id];
    if (!r) notRun++;
    else if (r.status === "pass") blocked++;
    else if (r.status === "fail") failed++;
    else errored++;
    if (r?.ledger.ok === true) ledgersOk++;
  }
  const cr = contrast ? runs[contrast.id] : undefined;
  return { total: attacks.length, blocked, failed, errored, notRun, ledgersOk, contrastDrained: cr && cr.status === "pass" ? cr.drained ?? 0n : null };
}

export function verdictOf(def: AttackDef, run: AttackRun | undefined): { word: string; tone: "wait" | "blocked" | "unsafe" | "fail" | "error" } {
  if (!run) return { word: "Not run", tone: "wait" };
  if (run.status === "error") return { word: "Lab error", tone: "error" };
  if (def.contrast) return run.status === "pass" ? { word: "Unsafe", tone: "unsafe" } : { word: "Did not reproduce", tone: "fail" };
  return run.status === "pass" ? { word: def.word, tone: "blocked" } : { word: "FAILED", tone: "fail" };
}

export { REENTRANCY_ERROR };
