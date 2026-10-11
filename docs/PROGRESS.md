# PROGRESS (Claude Code updates this at the end of every prompt)

## Status
| Prompt | Status | Notes |
|---|---|---|
| P00 Bootstrap | ✅ | see P00 verification below |
| P01 Contract core | ✅ | compiles with 0 warnings; smoke test passes |
| P02 Core tests | ✅ | 128 passing + 1 pending (re-entrancy placeholder for P03); mutation check done |
| P03 Attacks + invariant | ✅ | re-entrancy blocked, naive contrast drained, force-send surplus, TransferFailed restore, seeded fuzz |
| P04 Deploy + seed | ✅ | shared hashing + frozen vector, deploy/seed, ABI export, idempotent reset |
| P05 AI service | ✅ | validator V1-V11 + gate + rules + Ollama/Gemini + routes; real Ollama run recorded below |
| P06 AI eval | ⬜ | |
| P07 Web: agreement wizard | 🟨 | wizard works end to end in rules mode, ollama mode (against a qwen-shaped fake Ollama) and with the server down; NOT yet walked against a live LLM (see P07 verification) |
| P08 Web: milestones + ledger | ⬜ | |
| P09 Web: Attack Lab | ⬜ | |
| P10 Stretch | ⬜ | |
| P11 Integration + README | ⬜ | |
| P12 Judge-proof audit | ⬜ | |

Legend: ⬜ not started · 🟨 in progress · ✅ done (acceptance checks pass) · ✂️ cut

## Latest numbers
- Shared tests (vitest): 115 passing (canonical JSON, frozen hash vector, strict schema, fileSha256, validator V1-V11, merge, gate rules 1-4, sample consistency)
- Server tests (vitest): 40 passing (rules extractor, extract/fallback/retry/grounding via fake Ollama+Gemini, validate, gate-check, confirm 422/200, agreements route hardening, samples, no-chain grep)
- Contract tests: 138 passing / 138 total (0 pending). Includes the 4 booklet-required tests by exact name.
- Invariant fuzz (5 seeds x 200 steps = 1,000 steps, 21 vaults): 401 succeeded / 599 reverted; 13 distinct custom errors hit; every revert decoded to a vault custom error (no Panic, no empty revert); every success emitted an event; I1-I8 asserted after each step; failed calls left storage identical (I6).
- Coverage (MilestoneVault.sol, attack/ skipped via .solcover.js): lines 100% · branches 98.15% (only two unreachable defensive underflow guards in `reconcile()` remain uncovered)
- Web tests (vitest): 32 passing (wizard reducer/gate wiring, revert decoding). `npm run build -w web` and `tsc -b` clean. E2E `web/e2e/wizard.e2e.mjs` (real Chrome via playwright-core; `AI_MODE=ollama` for the live-LLM path): passes in both modes.
- AI eval: see docs/EVAL-RESULTS.md

## Decisions log
- 2026-10-11 P00: removed `"type": "module"` from `shared/package.json` (the P00 prompt asked for it). Hardhat's ts-node (CJS) failed to load `../../shared/src/index.ts` with `ERR_REQUIRE_ESM` ("is a .ts file whose nearest parent package.json contains type: module"). Without the flag, Hardhat scripts (ts-node), server (tsx) and web (Vite) all import shared fine. Use extensionless relative imports inside `shared/`.
- 2026-10-11 P00: `server/` is `"type": "module"` (tsx); `contracts/` stays CommonJS (Hardhat 2 requirement). Workspace dep is `"@mv/shared": "*"` (npm rejects `workspace:*`).
- 2026-10-11 P00: placeholder npm scripts call `node scripts/todo.mjs Pxx` (avoids cmd.exe quoting problems).
- 2026-10-11 P00: Ollama default model `llama3.2:3b` (per `.env.example`) is NOT installed; `qwen2.5:7b-instruct` is. Kept `.env.example` as specified. Either `ollama pull llama3.2:3b` or set `OLLAMA_MODEL=qwen2.5:7b-instruct` in `.env`. User decides (pull is ~2 GB).
- 2026-10-11 P05 design (advisor-reviewed): the gate RECOMPUTES what must be resolved from the original proposal + source text (validator in "proposal" mode ∪ the proposal's AI flags ∪ new flags created by editing); a caller sending `ambiguities: []` cannot skip rules 1-2 (tested, 422). Rule 3 re-runs the validator in "edited" mode, which skips grounding and source-text scans (a human-typed 1.5 ETH never appears in the source; the source still says "automatically" after the clause is removed). Grounding is therefore enforced through rule 2: `AMOUNT_NOT_IN_TEXT` is blocking, so a human must edit it or remove the clause. One-sentence answer to "why can't the AI change an amount": any amount must literally appear as "<n> ETH" in the source (else blocking AMOUNT_NOT_IN_TEXT), the validator recomputes all arithmetic, and the gate refuses to confirm until a human edits or removes anything blocking.
- 2026-10-11 P05: rules decide, not the model: after zod-parsing LLM output, `source`, `origin`, `id` (always `TYPE:index|agreement:0`), `severity` (from the type table; AI-only VAGUE_CONDITION is a warning) and every condition's `objective` flag are overwritten by rules. Milestone index = position. Quotes not found in the source (case/space/curly-quote/dash tolerant) are nulled with a note.
- 2026-10-11 P05: grounding compares only "<number> ETH" figures (as parseEther bigints) against the source, so "20 farmers" never grounds 20 ETH. Whole-text grounding only: "amount appears in that milestone's own quote" was NOT added (risk of false blocks for LLMs that quote short spans); revisit in P06 because `injection.txt` contains "100 ETH" in the text itself.
- 2026-10-11 P05: documented extras beyond V1-V11: `CURRENCY_UNCLEAR` (non-ETH currency field, or ₹/Rs/INR/$/USD/EUR/"or equivalent" in the source); MISSING_AMOUNT is suppressed when CONDITIONAL_AMOUNT already explains the missing figure for that milestone (so M3 "remaining funds" yields one flag, not two); V5 compares the sum of amounts that ARE present against the stated total (KrishiLens: 3.5 vs 5 -> AMOUNT_MISMATCH).
- 2026-10-11 P05: the rules extractor emits NO ambiguities itself; the shared validator (same lexicon) raises them all. For eval (P06) "rules" = extractor + validator; an LLM result = AI flags ∪ validator flags.
- 2026-10-11 P05: sample consistency is a test: rules extractor + sample edits + sample resolutions -> `assertConfirmable` -> same agreementHash as `samples/krishilens.confirmed.json`; merged ids == the five resolved ids. To get there `krishilens.txt` gained a header block (`Client:/Provider:/Arbiter:/Total: 5 ETH`), the sample's `sourceTextHash` was regenerated, and `deploy:demo` re-run (new pre-seeded agreementHash 0x19a7241c...5732; `web/src/generated/deployment.json` regenerated).
- 2026-10-11 P05: `server/src/app.ts` exports `createApp({fetchImpl, config, dataDir, samplesDir, now})` (tests inject a fake fetch so the test's own HTTP calls are not intercepted); `/api/gate-check` (dry-run of the gate) added for the P07 Confirm button; `/api/agreements/:hash` validates `^0x[0-9a-f]{64}$` before touching the filesystem; the server computes the hash itself and ignores any client-supplied one; bodies are zod-validated (400), only `GateError` is 422.
- 2026-10-11 P05: Ollama availability in `auto` = `/api/tags` answers within 1.5 s AND lists the configured model (avoids a wasted 404 chat call; `.env.example` default `llama3.2:3b` is not installed here). Gemini fails closed unless both `GEMINI_API_KEY` and `GEMINI_MODEL` are set (key sent in `x-goog-api-key`, never in the URL); not exercised against the real API (no key).
- 2026-10-11 Process: user asked for ONE commit about every 30 minutes (not per prompt). P05 work is uncommitted until the next 30-minute mark.
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

## P05 real Ollama run (2026-10-11, `OLLAMA_MODEL=qwen2.5:7b-instruct` for that one command; `.env` untouched)
- Cold first call: **26.8 s** (just under the 30 s timeout; a colder load could exceed it and fall back to rules with `fallbackReason`). Warm second call: **19.6 s**.
- Quality on krishilens.txt: parties, total, all three titles, amounts (1, 2.5, null) and deadlines (2026-10-31, 2026-12-15, null) correct. Merged flags = the five expected ids PLUS two the model added: `VAGUE_CONDITION:1:0` (warning) and **`UNDEFINED_TRANSITION:2:0` (blocking, a false positive: nothing in the text moves money automatically)**. One model quote was not in the source and was nulled (noted in `notes`).
- Consequence: with a live LLM the wizard shows one extra blocking flag the human must resolve (clause-removed/edited), so the live-wizard hash will not equal the pre-seeded sample hash unless that flag is resolved. Honest precision cost of AI flags; P06 eval should quantify it. Rule kept: the validator never removes an AI flag.

## P05 real-server fallback checks (2026-10-11)
- `OLLAMA_URL=http://127.0.0.1:9` (nothing listening): `source: "rules"`, 44 ms, `fallbackReason` "Ollama is not reachable at http://127.0.0.1:9; Gemini is not configured (...)", 3 milestones, 5 flags.
- Plain defaults from `.env.example` (`llama3.2:3b`, not installed here): `source: "rules"`, 52 ms, `fallbackReason` "Ollama model "llama3.2:3b" is not installed (installed: qwen2.5:7b-instruct, ...)", 5 flags. (A judge's machine with no Ollama gets the first message.)

## P07 verification (2026-10-11)
- Rules mode e2e: paste -> extract -> 5 cards -> Confirm locked with a reason -> acknowledging a blocking card is refused -> one-click fixes -> confirm -> deploy -> both sign -> fund -> /vault reconciles -> reload keeps the step. All requests stay on 127.0.0.1 (fonts/scripts bundled).
- Ollama mode: the Ollama model store on this machine is EMPTY now (`ollama list` shows nothing; qwen2.5:7b-instruct from P00/P05 is gone), so the walk used a throwaway fake Ollama returning a qwen-shaped answer (rules milestones + `VAGUE_CONDITION:1:0` + `UNDEFINED_TRANSITION:2:0`). Result: badge "Proposed by Ollama · qwen2.5:7b-instruct · 1.5 s"; 7 cards; the blocking UNDEFINED_TRANSITION resolves with "Remove this clause", the VAGUE_CONDITION warning with "Acknowledge", the gate opens, and deploy/sign/fund pass. **Still to do for ✅:** one walk with a real model (`ollama pull qwen2.5:7b-instruct` or llama3.2:3b, then `AI_MODE=ollama node web/e2e/wizard.e2e.mjs`); the e2e allows 120 s for the extract.
- Server down (killed server + Ollama): banner "The AI service isn't running. Start it with npm run server."; samples dropdown shows "No samples (server offline)"; pasted text is extracted by the in-browser rules (`lib/localExtract.ts`, "Proposed by Rules"); the gate runs locally; Confirm falls back to the shared gate in the browser and shows "Kept in this browser only: the AI service was offline." No console errors.
- Type boundary: `deployVault(confirmed: ConfirmedChecklist, hash, signer)` re-hashes before deploying and reads back hash/total; `deploy.boundary.ts` has a `@ts-expect-error` that makes `tsc -b` fail if a `ProposedChecklist` ever becomes deployable.
- Rough edges: (1) the wizard's one-click fixes give a different agreement hash from the pre-seeded vault (`0x19a7...`, built from the sample's resolutions); docs/06 does not assume they match. (2) A merged milestone-2 condition can read "...; A live demo shows..." (capital letter after the semicolon, from joining suggestions). (3) Production bundle is 646 kB in one chunk (Vite warning); harmless offline. (4) The ollama daemon is not auto-started; a judge without it gets the rules fallback with a reason.

## Open questions
- P01 / spec: `escalate` computes `completedAt + reviewWindow` in uint64 with checked arithmetic. A huge `reviewWindow` (near 2^64) would make `escalate` panic (Panic 0x11) instead of a custom error. Not changed (spec is source of truth); a constructor cap on `reviewWindow` would fix it if wanted.

## Known issues
- `extract` grounds/validates against the first 6,000 characters of the text, but the gate and `sourceTextHash` use the FULL text, so for agreements over 6k characters the gate can require flags the extract response never showed. Design answer (P07): drive the cards and the Confirm button from `/api/gate-check`, not from `/api/extract`.
- With a live LLM, AI false-positive flags (e.g. `UNDEFINED_TRANSITION:2:0` from qwen2.5:7b) must be resolved by a human; the validator never removes an AI flag. Only rules mode + the sample's resolutions reproduces the pre-seeded vault's agreement hash.
- Cold Ollama call took 26.8 s vs the 30 s timeout; extraction can take ~60 s with a retry. Consider a warm-up call at server start (P11).
- P06 is blocked on the teammate's 7 sample agreements + `samples/expected.json` (docs/07); only the builder-draft `krishilens.txt` exists.
