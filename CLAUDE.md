# Sealstone — Claude Code project memory

VORTEXA 3.0 (12-hour hackathon), problem **B-03 MilestoneVault: Adversarial Smart-Contract Escrow** (the booklet's title).
The PRODUCT is called **Sealstone**. Use that name in the UI, docs, README, logs and pitch. The Solidity contract keeps the booklet's identifier `MilestoneVault` (`MilestoneVault.sol`, ABI export, tests): that is a code name, not the brand.
Team: Omkar Rane (builder, drives Claude Code) + teammate (research, test scenarios, pitch).

Read these before any non-trivial change:
- `docs/01-PROBLEM.md` — the booklet requirements, verbatim, plus how each one maps to a feature
- `docs/02-PLAN.md` — the concept, architecture, schedule and cut order
- `docs/04-CONTRACT-SPEC.md` — the contract's states, functions, errors and invariants (source of truth)
- `docs/05-AI-SPEC.md` — the checklist schema, ambiguity types and fallback rules
- `docs/08-UI-UX.md` + `docs/ui-prototype/index.html` — the UI spec and the clickable visual reference (read before any web/ work)
- `docs/PROGRESS.md` — what is done, what is next. **Update it at the end of every prompt.**
Read only the docs a prompt names. Don't re-read everything each time.

## One-line pitch
Escrow that can't be tricked by ambiguous agreements, swapped deliverables, or malicious contracts.

## Three integrity layers (the whole product)
1. **Agreement integrity**: AI turns agreement prose into a *proposed* checklist plus ambiguities, a deterministic validator re-checks everything, a human resolves every ambiguity and confirms, and the keccak256 of the confirmed checklist is stored on-chain. Both client and provider sign that hash before funding.
2. **Deliverable integrity**: the provider submits the SHA-256 of the deliverable when marking a milestone complete. The client must approve **that exact hash**. A swapped deliverable makes approval revert.
3. **Fund integrity**: a role-gated state machine with pull payments, checks-effects-interactions and a reentrancy guard; a live reconciliation panel; and an Attack Lab that fires real adversarial transactions at the contract.

## Non-negotiable rules (judges will check)
Each rule is tagged with where it comes from. **[Booklet]** = the VORTEXA 3.0 problem booklet says it (B-03 page or Common Rules). **[Team]** = our own stricter choice; the booklet does not require it. The booklet publishes no judging rubric, so no scoring weights are known.
- **[Booklet] AI output is never written to the contract directly.** Only a human-confirmed checklist that passes the deterministic validator can be deployed. Keep this boundary visible in code (`confirmedChecklist` vs `proposedChecklist` types).
- **[Booklet] AI informs, rules decide.** Where a decision has real consequences, the outcome must follow explicit, checkable rules and AI "must not silently override them". Every money-moving decision is made by Solidity rules. The validator's arithmetic and party checks override the AI.
- **[Booklet] Local fallback is mandatory.** External AI may be used, but "the core demonstration must not depend on" it. **[Team]** We go further: the full demo must work with Wi-Fi off (rules-based extractor, local Hardhat node, no CDN fonts or scripts at runtime).
- **[Booklet] Undefined transitions are rejected** with a specific custom error. There is never a silent no-op.
- **[Booklet] The balance always reconciles.** `address(this).balance` must equal deposits minus withdrawals (forced ETH is reported as surplus, never counted).
- **[Booklet] Fictional data only.** "Do not use real personal records, real financial transactions, or live third-party systems." Simulated funds only: "No real cryptocurrency" (the booklet says no public deployment is *required*; it does not forbid one).
- **[Team] No public networks by default.** The local Hardhat node is the default and the mandatory offline fallback. A testnet deploy (MST, see PROGRESS.md decisions log) is optional, key-gated and run by the team; whether it counts as a "live third-party system" is unresolved, so ask the organizers before relying on it.
- **[Booklet]** The four required adversarial tests must exist by name: second release, unauthorized refund, out-of-order transition, reentrancy.

## Stack
- `contracts/`: Hardhat 2 + `@nomicfoundation/hardhat-toolbox` (ethers v6, chai, solidity-coverage), Solidity `0.8.24`, OpenZeppelin Contracts v5 (`ReentrancyGuard`). TypeScript config and tests.
- `server/`: Node 20+, Express, TypeScript (tsx), zod. AI providers: Ollama (local, default `llama3.2:3b`), Gemini (optional, via `GEMINI_API_KEY`), rules (always available). It also handles canonical JSON and hashing helpers.
- `web/`: Vite + React + TypeScript, ethers v6, connecting to the Hardhat node at `http://127.0.0.1:8545`. Roles are switched with Hardhat's unlocked accounts, so there is no MetaMask. Plain CSS with tokens, no UI kit.
- `shared/`: a TypeScript-only package (`@mv/shared`) with the checklist types, zod schemas, canonical JSON, hashing helpers and a shared test vector. `server/` and `web/` import it by package name; Hardhat scripts in `contracts/` import it by relative path (`../../shared/src/...`), because ts-node won't compile TS inside node_modules.
- `samples/`: fictional agreement texts and labelled expectations for the AI evaluation.

The host OS is **Windows**. Use cross-platform npm scripts (`cross-env`, `concurrently`, `rimraf`). Never use bash-only syntax in `package.json`.

## Commands (keep these working)
```
npm run setup          # install all workspaces
npm run chain          # hardhat node on 8545
npm run deploy:demo    # deploy + seed the demo scenario, write web/src/generated/
npm run test:contracts # hardhat test
npm run coverage       # solidity-coverage
npm run server         # AI service on 8787
npm run web            # vite on 5173
npm run dev            # chain + server + web together (concurrently)
npm run eval:ai        # extraction / ambiguity eval over samples/
npm run demo:reset     # restart chain and re-seed for a clean demo
```

## Conventions
- Solidity: custom errors (not revert strings), `onlyClient` / `onlyProvider` / `onlyArbiter` modifiers, an event for every state change, NatSpec on every external function, no `tx.origin`, no `selfdestruct`, no `delegatecall`, and `receive`/`fallback` revert.
- Amounts are in wei (`bigint` in TS, never `number`). Hashes are `0x`-prefixed 32-byte hex.
- Canonical JSON = keys sorted recursively, no whitespace, and amounts as decimal wei strings. There is exactly one implementation, `shared/src/canonical.ts`, with a fixed test vector in `shared/test/vector.json`. Never re-implement it elsewhere.
- Every test name states the guarantee, e.g. `"rejects a second release of the same milestone"`.
- Keep functions small. Don't add dependencies without a reason in PROGRESS.md.

## Working style for Claude Code
- Work one prompt file (`prompts/Pxx-*.md`) at a time. Finish its acceptance checks before moving on.
- Run the tests after every contract change. Never weaken a test to make it pass. Fix the code, or explain in PROGRESS.md why the spec changed.
- If something in the spec is wrong or impossible, stop and write the question in PROGRESS.md under "Open questions" rather than guessing.
- Prefer boring and correct over clever. This is judged on whether it breaks.
