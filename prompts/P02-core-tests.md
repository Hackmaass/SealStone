# P02 — Lifecycle, access-control and state-machine tests
**Depends on:** P01 · **Time box:** 60 min

## Paste this
````text
Read docs/04-CONTRACT-SPEC.md. Write the core test suites for MilestoneVault in contracts/test/ using hardhat-toolbox (ethers v6, chai, loadFixture, time helpers). Every test name must state the guarantee in plain English.

1. test/helpers/fixtures.ts
   - Signers: client=#0, provider=#1, arbiter=#2, stranger=#3.
   - Fixtures: deployedFixture (AwaitingSignatures), signedFixture (AwaitingFunding), activeFixture (funded; amounts 1, 2.5, 1.5 ETH; reviewWindow 3600), and helpers like completeMilestone(i), hashOf(str) = sha256(toUtf8Bytes(str)).
   - A helper expectReconciled(vault) that asserts every reconcile() field: ok, I3, I5, and expectedBalance == deposited - withdrawn.

2. test/Constructor.test.ts: rejects a zero address, duplicate parties (all 3 pairs), 0 milestones, 21 milestones, a zero amount, a zero agreementHash, reviewWindow 0. Accepts a valid config with totalAmount == Σ amounts.

3. test/Lifecycle.test.ts (happy paths; call expectReconciled after every step):
   - sign by both → AwaitingFunding; fund exact → Active
   - M0: markComplete → approve with the same hash → provider credited → withdraw → provider balance up by exactly the amount (account for gas using the receipt)
   - M1: markComplete → dispute → resolve(Release) → provider credited
   - M2: markComplete → dispute → resolve(Refund) → client credited → client withdraws
   - after the last milestone → Closed, AgreementClosed emitted
   - escalate after time.increase(reviewWindow) → Disputed → arbiter resolves
   - every event is emitted with the correct args

4. test/AccessControl.test.ts (table-driven): for every state-changing function, call it from every role that is NOT allowed (including stranger) in a state where it would otherwise succeed. Expect the exact custom error (NotClient / NotProvider / NotArbiter / NotSigner). Generate the cases from a table, not copy-paste.

5. test/StateMachine.test.ts (table-driven): for each milestone function × each milestone state (Pending, Completed, Disputed, Released, Refunded), assert that only the transitions in the spec's table succeed and that all others revert InvalidMilestoneState(index, actual). Also: markComplete on index 1 while index 0 isn't terminal → MilestoneOutOfOrder; any milestone action before funding → WrongAgreementState; an invalid index → InvalidMilestone.

6. test/Adversarial.test.ts — create the describe block "Booklet-required adversarial tests" with these exact test names:
   - "rejects a second release attempt": approve M0, then approve again → InvalidMilestoneState; also resolve on a released milestone → revert; the provider's credit is unchanged; expectReconciled.
   - "rejects an unauthorized refund": put M0 into Disputed; client calls resolve(Refund) → NotArbiter; provider and stranger → NotArbiter; then the arbiter refunding a NON-disputed milestone → InvalidMilestoneState; balances unchanged.
   - "rejects an out-of-order transition": approve before markComplete → InvalidMilestoneState; resolve before dispute → InvalidMilestoneState; markComplete(1) before M0 is terminal → MilestoneOutOfOrder; fund before both signatures → WrongAgreementState.
   - leave a placeholder `it.skip("blocks a re-entrancy attack")`. P03 implements it.
   Also in the same file, outside that describe: "rejects approval of a swapped deliverable" (DeliverableHashMismatch with the expected/provided args), "rejects wrong funding amount" (both less and more), "rejects funding twice", "rejects direct ETH transfers", "rejects signing a different agreement hash", "rejects signing twice", "rejects early escalation" (ReviewWindowOpen with the right timestamp), "rejects withdraw with no credit".

7. Run `npx hardhat test` and `npx hardhat coverage`. Target: MilestoneVault.sol 100% lines, ≥ 95% branches. Add tests for any uncovered branch. Never change the contract to make a test pass unless the test revealed a real spec violation; if so, explain it in PROGRESS.md.

Update docs/PROGRESS.md with the test count and coverage numbers. Commit "P02: core test suites".
````

## Acceptance checks
- [ ] All tests pass; coverage numbers recorded
- [ ] The three required names appear exactly in `npx hardhat test` output
- [ ] Spot-check one table-driven test: break a modifier on purpose (e.g. remove `onlyClient` from `approve`), confirm tests fail, then restore it
