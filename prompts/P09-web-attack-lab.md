# P09 — Attack Lab
**Depends on:** P08 · **Time box:** 60 min · **Use plan mode first**

## Paste this
````text
Read docs/04-CONTRACT-SPEC.md (errors + test contracts), docs/06-DEMO-SCRIPT.md steps 10–11 and docs/08-UI-UX.md ("Attack Lab" section). Open docs/ui-prototype/index.html → Attack Lab → "Run all attacks" and match its table, star markers, row cursor, verdict stamps, score and contrast row; the prototype's rows are simulated, yours run real transactions. Build /attack-lab in web/: a page where anyone can fire real adversarial transactions at a sandbox vault and see expected vs actual results.

1. Sandbox setup (button "Create fresh sandbox", also run on first load): deploy a new MilestoneVault using the sandbox accounts (#4 client, #5 provider, #6 arbiter, #3 attacker) with 3 milestones (1, 1, 1 ETH) and a short review window, then sign and fund. A second sandbox uses a ReentrantProvider as the provider. Never touch the main demo vaults.

2. Attack catalogue (lib/attacks.ts, data-driven). Each attack has: id, title, plain-English "what the attacker tries", actor, setup steps (bring the sandbox into the needed state), the attack call, expected outcome ({ revert: "ErrorName" } or { success: true, check }), and the booklet requirement it covers (R-number from docs/01).
   1. Second release: approve M0, then approve M0 again → InvalidMilestoneState  [booklet]
   2. Unauthorized refund: dispute M0, the client calls resolve(Refund) → NotArbiter; the stranger tries → NotArbiter  [booklet]
   3. Out-of-order transition: approve before complete → InvalidMilestoneState; complete M1 before M0 is terminal → MilestoneOutOfOrder  [booklet]
   4. Re-entrancy: the ReentrantProvider withdraws and re-enters → success, but the row shows attempts/blocked/succeeded counters (expect succeeded = 0 and the received amount == the owed amount)  [booklet]
   5. Swapped deliverable → DeliverableHashMismatch
   6. Provider approves own milestone → NotClient
   7. Arbiter resolves a non-disputed milestone → InvalidMilestoneState
   8. Wrong funding amount / funding twice → WrongFundingAmount / WrongAgreementState (use a separate unfunded sandbox)
   9. Direct ETH transfer to the vault → DirectPaymentNotAccepted
   10. Force-sent ETH (ForceSender) → success; check surplus > 0 and reconcile().ok still true
   11. Early escalation → ReviewWindowOpen
   12. Withdraw with no credit → NothingToWithdraw
   Contrast row (visually separated, red-tinted): "Same re-entrancy vs NaiveEscrow" → expect a drain; show the ETH stolen.

3. UI: a table or cards with Run buttons, plus "Run all" (sequential, with a small delay so the audience can follow). Each row shows expected, actual (the decoded error name + args), PASS/FAIL, the tx hash for successes, gas used, and a mini ledger status (✓ reconciled after the attack). Summary at the top: "12/12 attacks blocked · ledger reconciled after each". Rows tagged [booklet] get a badge.
   Under each row, a collapsible "Proven in tests:" showing the matching test name from contracts/test (hard-coded mapping is fine).

4. Make "Run all" idempotent: it rebuilds the sandbox first, so it can run repeatedly during judging.

Run "Run all" three times in a row; all rows must PASS each time. Update PROGRESS.md. Commit "P09: Attack Lab".
````

## Acceptance checks
- [ ] "Run all" passes 3 times in a row with no page reload
- [ ] The naive contrast visibly drains funds
- [ ] Each booklet attack has its badge and a linked test name
