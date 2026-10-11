# PROGRESS (Claude Code updates this at the end of every prompt)

## Status
| Prompt | Status | Notes |
|---|---|---|
| P00 Bootstrap | ✅ | see P00 verification below |
| P01 Contract core | ✅ | compiles with 0 warnings; smoke test passes |
| P02 Core tests | ✅ | 128 passing + 1 pending (re-entrancy placeholder for P03); mutation check done |
| P03 Attacks + invariant | ✅ | re-entrancy blocked, naive contrast drained, force-send surplus, TransferFailed restore, seeded fuzz |
| P04 Deploy + seed | ✅ | shared hashing + frozen vector, deploy/seed, ABI export, idempotent reset |
| P05 AI service | ⬜ | |
| P06 AI eval | ⬜ | |
| P07 Web: agreement wizard | ⬜ | |
| P08 Web: milestones + ledger | ⬜ | |
| P09 Web: Attack Lab | ⬜ | |
| P10 Stretch | ⬜ | |
| P11 Integration + README | ⬜ | |
| P12 Judge-proof audit | ⬜ | |

Legend: ⬜ not started · 🟨 in progress · ✅ done (acceptance checks pass) · ✂️ cut

## Latest numbers
- Shared tests (vitest): 31 passing (canonical JSON, frozen hash vector, strict schema, fileSha256 == ethers.sha256)
- Contract tests: 138 passing / 138 total (0 pending). Includes the 4 booklet-required tests by exact name.
- Invariant fuzz (5 seeds x 200 steps = 1,000 steps, 21 vaults): 401 succeeded / 599 reverted; 13 distinct custom errors hit; every revert decoded to a vault custom error (no Panic, no empty revert); every success emitted an event; I1-I8 asserted after each step; failed calls left storage identical (I6).
- Coverage (MilestoneVault.sol, attack/ skipped via .solcover.js): lines 100% · branches 98.15% (only two unreachable defensive underflow guards in `reconcile()` remain uncovered)
- AI eval: see docs/EVAL-RESULTS.md

## Decisions log
- 2026-10-11 P00: removed `"type": "module"` from `shared/package.json` (the P00 prompt asked for it). Hardhat's ts-node (CJS) failed to load `../../shared/src/index.ts` with `ERR_REQUIRE_ESM` ("is a .ts file whose nearest parent package.json contains type: module"). Without the flag, Hardhat scripts (ts-node), server (tsx) and web (Vite) all import shared fine. Use extensionless relative imports inside `shared/`.
- 2026-10-11 P00: `server/` is `"type": "module"` (tsx); `contracts/` stays CommonJS (Hardhat 2 requirement). Workspace dep is `"@mv/shared": "*"` (npm rejects `workspace:*`).
- 2026-10-11 P00: placeholder npm scripts call `node scripts/todo.mjs Pxx` (avoids cmd.exe quoting problems).
- 2026-10-11 P00: Ollama default model `llama3.2:3b` (per `.env.example`) is NOT installed; `qwen2.5:7b-instruct` is. Kept `.env.example` as specified. Either `ollama pull llama3.2:3b` or set `OLLAMA_MODEL=qwen2.5:7b-instruct` in `.env`. User decides (pull is ~2 GB).
- 2026-10-11 P04: `shared/` now depends on `zod@^3` and `ethers@^6` (declared, not hoisting luck). Canonical JSON uses the default UTF-16 key sort (never localeCompare) and throws on undefined/bigint/NaN/Infinity/functions/non-plain objects. Schema is `.strict()`; one canonical form per value (amountWei `^[1-9][0-9]*$`, EIP-55 addresses, lowercase 32-byte hashes, YYYY-MM-DD deadlines, index == position, distinct addresses). `agreementHash()` re-parses with the schema before hashing. Frozen vector (`shared/test/vector.json`) has unsorted keys and non-ASCII text; the canonical string was cross-checked against Python's `json.dumps(sort_keys, separators, ensure_ascii=False)`.
- 2026-10-11 P04: `samples/agreements/krishilens.txt` is a BUILDER DRAFT (the teammate owns the final text, docs/07). If they change it, `extraction.sourceTextHash` in `samples/krishilens.confirmed.json` must be regenerated (deploy-demo warns on mismatch). Resolutions use spec ids (`CONDITIONAL_AMOUNT:2:0`...): blocking items edited/clause-removed, the M3 missing-deadline warning acknowledged (deadline stays null), total 5 ETH.
- 2026-10-11 P04: `web/src/generated/` is now COMMITTED (removed from .gitignore) so a fresh clone type-checks/builds before running deploy:demo; `generatedAt` changes on every run. `npm run build -w web` passes with `erasableSyntaxOnly`/`verbatimModuleSyntax` while importing shared + generated code.
- 2026-10-11 P04: `contracts/scripts/export-abi.ts` also exports RejectingProvider (extra attacker from P03). `demo:reset` = `hardhat_reset` + redeploy: the vault address is identical across resets (0x5FbDB2315678afecb367f032d93F642f64180aa3) because the deployer nonce returns to 0. NOTE for P08/P11: after a reset the block number goes backwards, so the browser must recreate its provider / reload.
- 2026-10-11 P03: attack contracts in `contracts/contracts/attack/`: ReentrantProvider (records `lastRevertSelector`; the test asserts it equals `ReentrancyGuardReentrantCall`), RejectingProvider (extra: proves `TransferFailed` restores the credit), NaiveEscrow + NaiveDrainer (1 ETH credit drains 4 ETH; escrow zeroes with `= 0` after the call), ForceSender. Known compiler warning: the `selfdestruct` deprecation in `ForceSender.sol` only (test-only contract, required by spec).
- 2026-10-11 P03: Invariant.test.ts uses a state-aware generator (~50% valid calls, 30% of those perturbed into near misses) and redeploys a fresh random vault (1-8 milestones) once one closes and drains. Mutation check: dropping `totalReleased += amount` fails all 5 seeds (I4/I5) with replay info; restored.
- 2026-10-11 Process: user asked that commits carry no Claude co-author/attribution, only their identity. Existing P00-P02 commits were rewritten to strip the trailer; repo-local `user.name` set to Omkar Rane.
- 2026-10-11 P02: suites = Constructor, Lifecycle, AccessControl (table), StateMachine (table: 6 functions x 5 milestone states + ordering/index/pre-funding), Adversarial. Mutation check: removing `onlyClient` from `approve` makes 4 tests fail; restored. Force-ETH and balance-drain are simulated with `hardhat_setBalance` in P02; the real `ForceSender` (selfdestruct) comes in P03.
- 2026-10-11 P01: contract implemented to the spec exactly. Constructor params are named `client_`/`provider_`/`arbiter_`/`agreementHash_`/`reviewWindow_` (avoids shadowing the immutables). `milestones` array is private; `getMilestone(i)` reverts `InvalidMilestone`. `fallback()` is `external payable` so value+data calls hit `DirectPaymentNotAccepted`. `reconcile()` guards every subtraction so it never reverts. Out-of-order (`i == nextMilestone`) is checked after the milestone-state check and before `ZeroHash`.
- 2026-10-11 P01: terminal-state rejection tests (P02) must use M0 while the agreement is still Active; on the last milestone the agreement is Closed, so `WrongAgreementState` fires first (correct per spec).
- 2026-10-11 P00: `server/src/index.ts` loads `.env` from the repo root (npm runs the server from `server/`). `.gitattributes` added (`* text=auto eol=lf`) since this product hashes text.
- 2026-10-11 P00: Vite scaffold resolved to Vite 8 / React 19 / TypeScript 6 (newest create-vite). Dev server pinned to 127.0.0.1:5173 with `strictPort`.

## P00 verification (2026-10-11)
- `node -v` → v24.19.0 (npm 11.17.0, git 2.55.0). Hardhat resolved 2.29.1, toolbox 5.0.0; `@openzeppelin/contracts/utils/ReentrancyGuard.sol` present.
- `npx hardhat compile` (contracts/) → "Compiled 1 Solidity file successfully (evm target: cancun)", no warnings.
- shared→contracts import probe (`hardhat run`), shared→server probe (`tsx`): both print `mv-shared-ok` (after the decision above).
- Server: `GET http://127.0.0.1:8787/api/health` → `{"ok":true}`. Web: Vite 8 serves the placeholder at http://127.0.0.1:5173/. Both stopped afterwards.
- `ollama --version` client 0.34.0. `ollama list`: `qwen2.5:7b-instruct` (4.7 GB), `hf.co/HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive:Q6_K_P` (7.2 GB), `hf.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive:Q4_K_M` (6.5 GB). No `llama3.2:3b`.
- npm install warned: 60 audit vulnerabilities in transitive dev deps (hardhat toolchain), and "allow-scripts" notes for keccak/secp256k1/esbuild install scripts (not run; everything above works without them).

## Open questions
- P01 / spec: `escalate` computes `completedAt + reviewWindow` in uint64 with checked arithmetic. A huge `reviewWindow` (near 2^64) would make `escalate` panic (Panic 0x11) instead of a custom error. Not changed (spec is source of truth); a constructor cap on `reviewWindow` would fix it if wanted.

## Known issues
-
