# 01 — Problem statement and requirement traceability

## B-03 — MilestoneVault: Adversarial Smart-Contract Escrow (verbatim from the booklet)

> Our product name is **Sealstone**. The booklet's title above is kept verbatim so judges can match it; the contract is still `MilestoneVault.sol`.

**Problem Overview.** Milestone-based agreements are common in freelance work, construction, and grant funding: payment follows approved deliverables, and disputes are common. Escrow is usually held by an intermediary whose rules are not visible. A contract can make the conditions explicit, but code that controls money is unforgiving. A payment released twice cannot easily be recovered, a missing access check lets the wrong person take funds, and a re-entrant call can drain funds before state is updated. Agreement text, meanwhile, is written in prose with ambiguous conditions that must be resolved before any money is committed.

**The Challenge.** Build a milestone-based escrow in which simulated funds are released or refunded only when the agreement's conditions are met. The agreement names a client, a provider, and an arbiter who resolves disputes, and defines each milestone's amount and approval conditions.

- Implement the core logic as a Solidity smart contract, tested on a local Hardhat network or an equivalent local setup. No real cryptocurrency and no public deployment are required.
- Enforce the lifecycle: the provider marks a milestone complete; the client approves it (releasing funds) or disputes it (passing the decision to the arbiter); the arbiter releases or refunds disputed funds. Each step is limited to the party allowed to take it, and undefined transitions are rejected.
- Prevent duplicate releases, unauthorized refunds, and out-of-order transitions. The contract's balance must always reconcile with deposits and payments.
- Back each guarantee with automated tests covering normal and adversarial actions, including a second release attempt, an unauthorized refund, an out-of-order transition, and a re-entrancy attack.
- AI may convert agreement text into a proposed checklist of milestones, amounts, conditions, and ambiguities. A person must confirm it, ambiguities must be resolved, and AI output must never be written to the contract directly.

## Common rules (apply to every team)

- **Deliverable:** a working software MVP that judges can test live. Mockups, static dashboards, slides and conceptual designs alone are not enough.
- **Reproducibility:** the solution must support reproducible live testing, using inputs permitted by the problem statement.
- **AI:** every solution must use AI meaningfully (language understanding, classification, matching, forecasting, extraction or adaptation). A chatbot, or an LLM call that only rewrites text, does not qualify. AI may be combined with deterministic logic, validation and optimization.
- **Correctness:** where a decision has real consequences (eligibility, authorization, arithmetic, scheduling), the outcome must follow explicit, checkable rules. AI may inform such decisions but must not silently override them.
- **Data:** no organizer dataset is provided. Use manual inputs, your own files, team-generated scenarios or small built-in examples. Use fictional data only; do not use real personal records, real financial transactions, or live third-party systems.
- **Infrastructure:** no paid API, paid cloud service, GPU or special hardware is required. External AI services may be used, but the core demonstration must not depend on them; provide a local fallback.

> **Checked against the booklet PDF (2026-10-11):** the B-03 page and the six Common Rules above match the booklet. Notes:
> - The booklet publishes **no judging rubric or scoring weights**. Any percentages you see elsewhere (e.g. from other hackathons) are not VORTEXA's.
> - **"Wi-Fi off" is our rule, not the booklet's.** The booklet requires only that the core demo not depend on external AI and that a local fallback exists. We choose the stricter standard (see C2).
> - **"No public networks" is our rule, not the booklet's.** The booklet says "no public deployment [is] required"; it does not forbid one. A testnet deploy may still be read as a "live third-party system" (Data rule), so it is a gray area: see PROGRESS.md.
> - Third-party oracles (Chainlink, GenLayer) are excluded by our offline standard and arguably by the "live third-party systems" clause, not by the AI-fallback rule (oracles are not AI).

## Traceability matrix (every requirement → where it's satisfied → how it's proven)

| # | Requirement | Feature | Proof a judge can see |
|---|---|---|---|
| R1 | Solidity contract on local Hardhat | `contracts/contracts/MilestoneVault.sol` on `hardhat node` | Live demo; `npm run test:contracts` |
| R2 | Client, provider and arbiter named | Constructor params, immutable, must be distinct and non-zero | Test: rejects duplicate or zero parties |
| R3 | Per-milestone amount + conditions | `amounts[]` on-chain; conditions in the confirmed checklist whose hash is on-chain | Agreement page shows hash match ✓ |
| R4 | Provider marks complete | `markComplete(i, deliverableHash)`, `onlyProvider` | UI + test |
| R5 | Client approves → release | `approve(i, deliverableHash)`, `onlyClient`, hash must match | UI + test + swapped-deliverable attack |
| R6 | Client disputes → arbiter | `dispute(i, evidenceHash)`, `onlyClient` | UI + test |
| R7 | Arbiter releases or refunds | `resolve(i, ruling, rationaleHash)`, `onlyArbiter` | UI + test |
| R8 | Each step limited to its party | Role modifiers | Attack Lab: wrong-role buttons |
| R9 | Undefined transitions rejected | `InvalidMilestoneState(i, actual)` on every function | Attack Lab: out-of-order button |
| R10 | No duplicate release | Terminal states; credits zeroed before transfer | Test + Attack Lab |
| R11 | No unauthorized refund | Only `resolve` refunds, only the arbiter, only when Disputed | Test + Attack Lab |
| R12 | Balance always reconciles | `reconcile()` view + live panel + randomized invariant test | Panel stays green through every attack |
| R13 | Tests: second release, unauthorized refund, out-of-order, reentrancy | `test/Adversarial.test.ts` with exactly those names | Test output in README and on screen |
| R14 | AI → proposed checklist with ambiguities | `server/` extract endpoint (Ollama / Gemini / rules) | Agreement wizard step 2 |
| R15 | A person confirms; ambiguities resolved | Confirm button disabled until every ambiguity has a resolution | UI gate; validator test |
| R16 | AI output never written directly | Type boundary `ProposedChecklist` → `ConfirmedChecklist`; deploy accepts only confirmed + validated | Code walk-through; hash shown |
| C1 | AI used meaningfully | Extraction + ambiguity classification, measured by an eval | `npm run eval:ai` metrics in README |
| C2 | Local fallback | Rules extractor + Ollama; demo with Wi-Fi off | Toggle "offline" in UI header |
| C3 | Reproducible live testing | `npm run demo:reset`, seeded scenarios, Attack Lab sandbox | Judges click buttons themselves |
| C4 | Fictional data | `samples/` only | — |
