import { expect } from "chai";
import {
  AGREEMENT_HASH,
  Ctx,
  Ruling,
  TOTAL,
  activeFixture,
  deliverableOf,
  deployedFixture,
  evidenceOf,
  loadFixture,
  m0Completed,
  m0Disputed,
  m0Escalatable,
  rationaleOf,
  signedFixture,
} from "./helpers/fixtures";

type Role = "client" | "provider" | "arbiter" | "stranger";
const ALL_ROLES: Role[] = ["client", "provider", "arbiter", "stranger"];

interface AccessCase {
  fn: string;
  /** A state in which the allowed role's call would succeed. */
  fixture: () => Promise<Ctx>;
  allowed: Role[];
  error: string;
  call: (ctx: Ctx, who: Role) => Promise<unknown>;
}

// One row per state-changing function. Every role NOT in `allowed` must be rejected with `error`,
// in a state where the call would otherwise succeed (so the role check is the only thing failing).
const CASES: AccessCase[] = [
  {
    fn: "sign",
    fixture: deployedFixture,
    allowed: ["client", "provider"],
    error: "NotSigner",
    call: (c, who) => c.vault.connect(c[who]).sign(AGREEMENT_HASH),
  },
  {
    fn: "fund",
    fixture: signedFixture,
    allowed: ["client"],
    error: "NotClient",
    call: (c, who) => c.vault.connect(c[who]).fund({ value: TOTAL }),
  },
  {
    fn: "markComplete",
    fixture: activeFixture,
    allowed: ["provider"],
    error: "NotProvider",
    call: (c, who) => c.vault.connect(c[who]).markComplete(0, deliverableOf(0)),
  },
  {
    fn: "approve",
    fixture: m0Completed,
    allowed: ["client"],
    error: "NotClient",
    call: (c, who) => c.vault.connect(c[who]).approve(0, deliverableOf(0)),
  },
  {
    fn: "dispute",
    fixture: m0Completed,
    allowed: ["client"],
    error: "NotClient",
    call: (c, who) => c.vault.connect(c[who]).dispute(0, evidenceOf(0)),
  },
  {
    fn: "escalate",
    fixture: m0Escalatable,
    allowed: ["provider"],
    error: "NotProvider",
    call: (c, who) => c.vault.connect(c[who]).escalate(0),
  },
  {
    fn: "resolve(Release)",
    fixture: m0Disputed,
    allowed: ["arbiter"],
    error: "NotArbiter",
    call: (c, who) => c.vault.connect(c[who]).resolve(0, Ruling.Release, rationaleOf(0)),
  },
  {
    fn: "resolve(Refund)",
    fixture: m0Disputed,
    allowed: ["arbiter"],
    error: "NotArbiter",
    call: (c, who) => c.vault.connect(c[who]).resolve(0, Ruling.Refund, rationaleOf(0)),
  },
];

describe("Access control (every function rejects every role that is not allowed to call it)", () => {
  for (const c of CASES) {
    describe(c.fn, () => {
      for (const who of ALL_ROLES.filter((r) => !c.allowed.includes(r))) {
        it(`rejects the ${who} with ${c.error}`, async () => {
          const ctx = await loadFixture(c.fixture);
          await expect(c.call(ctx, who)).to.be.revertedWithCustomError(ctx.vault, c.error);
        });
      }
      for (const who of c.allowed) {
        it(`accepts the ${who} (so the rejection above is purely the role check)`, async () => {
          const ctx = await loadFixture(c.fixture);
          await expect(c.call(ctx, who)).to.not.be.reverted;
        });
      }
    });
  }

  it("never lets the arbiter hold credit, whatever the ruling (the arbiter can never be paid)", async () => {
    const ctx = await loadFixture(m0Disputed);
    await ctx.vault.connect(ctx.arbiter).resolve(0, Ruling.Refund, rationaleOf(0));
    expect(await ctx.vault.credits(ctx.arbiter.address)).to.equal(0);
    await expect(ctx.vault.connect(ctx.arbiter).withdraw()).to.be.revertedWithCustomError(ctx.vault, "NothingToWithdraw");
  });
});
