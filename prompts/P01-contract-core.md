# P01 — MilestoneVault contract
**Depends on:** P00 · **Time box:** 60 min · **Use plan mode first**

## Paste this
````text
Read CLAUDE.md, docs/01-PROBLEM.md and especially docs/04-CONTRACT-SPEC.md. That spec is the source of truth. Implement contracts/contracts/MilestoneVault.sol exactly as specified.

Requirements:
- Solidity 0.8.24, import "@openzeppelin/contracts/utils/ReentrancyGuard.sol" (OZ v5 path).
- Storage, enums, structs, functions, custom errors and events exactly as in the spec. If you think the spec is wrong, stop and tell me before deviating.
- The check order in every function is: role → agreement state → index → milestone state → extra checks. Use modifiers onlyClient / onlyProvider / onlyArbiter and a modifier or helper for agreement state.
- withdraw(): nonReentrant + checks-effects-interactions: read the credit, zero it, add to totalWithdrawn, then call{value:}. Revert TransferFailed if the call fails (which restores everything).
- Credits only ever go to client or provider. Never to the arbiter.
- After a milestone becomes terminal (Released/Refunded): nextMilestone = index + 1. When the last milestone becomes terminal, set Closed and emit AgreementClosed.
- reconcile() returns the Reconciliation struct exactly as specified (loop over ≤ 20 milestones for heldByMilestones).
- receive() and fallback() revert DirectPaymentNotAccepted().
- No tx.origin, no delegatecall, no selfdestruct, no unchecked blocks, no assembly.
- NatSpec on every external/public function, saying who may call it and which errors it can throw.
- Delete Placeholder.sol.

Also add contracts/test/Smoke.test.ts: deploy with 3 milestones (1, 2.5, 1.5 ETH), sign by both, fund 5 ETH, assert reconcile().ok is true. This is a smoke test only; the full suites come in P02/P03.

Run `npx hardhat compile` and `npx hardhat test`. Fix warnings too.

Update docs/PROGRESS.md (P01 ✅, any spec questions under Open questions). Commit "P01: MilestoneVault core contract".
````

## Acceptance checks
- [ ] Compiles with no warnings
- [ ] Smoke test passes
- [ ] Open the file yourself and check: `withdraw` zeroes the credit **before** the `call`; `approve` compares the deliverable hash; `resolve` is `onlyArbiter` and requires `Disputed`
- [ ] No `transfer`/`send`, no `tx.origin`
