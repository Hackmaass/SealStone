# P08 — Vault dashboard: milestones, deliverable hashing, timeline, ledger
**Depends on:** P07 · **Time box:** 75 min

## Paste this
````text
Read docs/04-CONTRACT-SPEC.md, docs/06-DEMO-SCRIPT.md (steps 6–9) and docs/08-UI-UX.md ("Vault" section, components, states, copy deck). Open docs/ui-prototype/index.html, go to the Vault tab and try every role. Match its layout, ruled milestone rows, state track, "Waiting for" line, "Try anyway" menu, approve sheet with side-by-side seals, ledger equation and activity list. Reuse the components from web/src/ui/; don't create new variants. Build /vault/:address in web/.

1. Header card: title (from the stored confirmed JSON), parties with role chips, agreementState, total, agreementHash, and a "Verify agreement" button. It fetches GET /api/agreements/:hash, recomputes canonical JSON + keccak256 in the browser with @mv/shared, and compares the result to the on-chain agreementHash → ✓ match (green) or ✗ mismatch (red). Also allow verifying a JSON file the user drops in.

2. Milestone cards (one per milestone): a state stepper (Pending → Completed → Released | Disputed → Released/Refunded), amount, conditions from the confirmed JSON, deadline, the stored deliverable hash, evidence hash and rationale hash. Actions shown depend on the current role from the header switcher:
   - Provider · Mark complete: a file drop zone or a text field ("git commit SHA" option) → compute SHA-256 in the browser (shared fileSha256; for text, sha256 of UTF-8 bytes) → show the hash → send markComplete.
   - Client · Approve: the client must drop the file they reviewed → the hash is computed → a preview shows match or mismatch against the stored hash. A mismatch warning still lets them send (so the contract's revert is visible), labelled "Send anyway (the contract will decide)".
   - Client · Dispute: an evidence text box → keccak256 → dispute(index, hash). Store the text locally via POST to the server (add a tiny /api/notes route keyed by hash; it's fine to keep it in memory).
   - Provider · Escalate: enabled only after the review window, with a countdown. Include a "Demo control: advance local chain time" button (evm_increaseTime + evm_mine) that is clearly labelled as local-only.
   - Arbiter · Resolve: Release or Refund + a required rationale text → keccak256.
   - Anyone · Withdraw: show the credits of the current role; the button is disabled at zero but has a "Try anyway" option.
   Disabled buttons always show WHY they are disabled (role, state, order). Every role also gets a small "Try anyway" link for actions it isn't allowed to take, so judges can see the contract enforce it.

3. Timeline: all vault events via queryFilter from deployment block, newest first, with decoded args, block, tx hash, and the actor's role chip. Also include failed attempts made from this UI (kept in client state and marked "reverted: <ErrorName>"), so the timeline shows rejected attacks too.

4. Ledger panel (sticky on the right on desktop, below on mobile): call reconcile() on every new block and show deposited, released, refunded, withdrawn, held in escrow, held by milestones, owed to parties, expected vs actual balance, and surplus, with a big ✓ RECONCILED (green) or ✗ (red) status. Include a small bar visual of where the total currently sits (held / owed / withdrawn). Animate value changes subtly.

5. Run the demo-script steps 6–9 end to end on a wizard-created vault AND on the pre-seeded vault. Fix issues.

Update PROGRESS.md. Commit "P08: vault dashboard, deliverable hashing, timeline, ledger".
````

## Acceptance checks
- [ ] Swapped-file approval shows `DeliverableHashMismatch` with both hashes, and the ledger stays green
- [ ] Verify agreement shows ✓ for the real JSON and ✗ if you edit one character
- [ ] Escalation works with the time-advance control
- [ ] The timeline shows rejected attempts too
