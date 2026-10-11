# Sealstone

**Escrow that can't be tricked by ambiguous agreements, swapped deliverables, or malicious contracts.**
VORTEXA 3.0 · problem B-03 *MilestoneVault: Adversarial Smart-Contract Escrow* · fictional data only, local chain only.

Milestone escrow fails in three ways. Most projects fix only the last one. Sealstone closes all three, and every claim can be broken live by you:

```
 ┌───────────────────────────────────────────────────────────────────────────────────────────┐
 │ 1  AGREEMENT INTEGRITY   AI proposes ─▶ validator re-checks ─▶ a person resolves every     │
 │                          ambiguity ─▶ keccak256(confirmed checklist) stored on-chain ─▶    │
 │                          client AND provider sign that hash before any money moves         │
 ├───────────────────────────────────────────────────────────────────────────────────────────┤
 │ 2  DELIVERABLE INTEGRITY provider commits SHA-256(file) ─▶ the client must approve that    │
 │                          exact hash. A swapped file makes approval revert.                 │
 ├───────────────────────────────────────────────────────────────────────────────────────────┤
 │ 3  FUND INTEGRITY        role-gated state machine · pull payments · checks-effects-        │
 │                          interactions · reentrancy guard · live reconciliation panel ·     │
 │                          an Attack Lab that fires REAL adversarial transactions at it      │
 └───────────────────────────────────────────────────────────────────────────────────────────┘
   AI informs, Solidity decides. AI output is never written to the contract directly.
```

## Quick start (Windows, macOS, Linux)

Needs Node 20+ (developed on Node 24) and git. Nothing else, and no internet after the install.

```bash
npm run setup          # install every workspace
copy .env.example .env # (macOS/Linux: cp .env.example .env)   optional; defaults work
npm run dev            # local chain + AI service + web app, seeds the demo vault, prints the URLs
```

Open **http://127.0.0.1:5173**. `npm run dev` prints a short banner with the app, the demo vault and the Attack Lab. Stop everything with Ctrl+C. Reset the demo at any time with `npm run demo:reset`.

**Optional local AI (Ollama).** Without it Sealstone uses its built-in rules extractor, and the whole demo still works.
```bash
ollama pull llama3.2:3b          # the default in .env.example
# or any installed model:  set OLLAMA_MODEL=qwen2.5:7b-instruct in .env
```

**Offline mode.** Turn Wi-Fi off and use *AI → Rules (offline)* in the top bar. Everything runs on `127.0.0.1`: the chain, the AI service, the app, fonts and scripts (all bundled, no CDN). If Ollama is not running, extraction falls back to the rules automatically and says why. If the AI service is not running, the app falls back to the same rules inside the browser.

| Command | What it does |
|---|---|
| `npm run dev` | chain + AI service + web, seeds the demo, prints URLs |
| `npm run demo:reset` | reset the chain and re-seed the demo vault (same address every time) |
| `npm run test:contracts` | the Hardhat test suite |
| `npm run coverage` | solidity-coverage |
| `npm run test:shared` | shared package tests (canonical JSON, hashing, validator, gate) |
| `npm run chain` / `server` / `web` | each service on its own |
| `npm run eval:ai` | AI evaluation (**not built yet**, see Status) |

## Try to break it
1. Open the **demo vault** (linked by `npm run dev`). Switch roles with the keys **1–4** (client, provider, arbiter, anyone).
2. As the client, **Approve with file…** and pick `m1-report-v2.pdf`: the seals differ and the contract refuses it (`DeliverableHashMismatch`). Pick `m1-report.pdf` and the milestone is released.
3. Under any milestone, **Try anyway** sends the real transaction from the wrong role and shows the contract's refusal in plain words. The ledger stays reconciled.
4. Open the **Attack Lab** and press *Run all attacks*, or run any single attack.

## Requirement → proof

| # | Requirement | Where it lives | How to see it |
|---|---|---|---|
| R1 | Solidity contract on local Hardhat | `contracts/contracts/MilestoneVault.sol` | `npm run dev`; `npm run test:contracts` |
| R2 | Client, provider, arbiter named | immutable constructor params, distinct and non-zero | constructor tests |
| R3 | Per-milestone amount and conditions | amounts on-chain; conditions in the confirmed checklist whose hash is on-chain | vault header: *Terms match the signed seal* |
| R4–R7 | Mark complete, approve, dispute, resolve | `markComplete`, `approve`, `dispute`, `resolve` with role modifiers | vault screen, lifecycle tests |
| R8 | Each step limited to its party | `onlyClient` / `onlyProvider` / `onlyArbiter` | **Try anyway** menus; access-control table test |
| R9 | Undefined transitions rejected | a specific custom error on every function (never a silent no-op) | Attack Lab; state-machine table test (6 functions × 5 states) |
| R10 | No duplicate release | terminal states; credit zeroed before payout | Attack Lab row 1; `rejects a second release attempt` |
| R11 | No unauthorized refund | only `resolve`, only the arbiter, only when disputed | Attack Lab row 2; `rejects an unauthorized refund` |
| R12 | Balance always reconciles | `reconcile()` + live ledger + randomized invariant test; forced ETH shows as surplus | ledger panel stays green through every attack |
| R13 | The four required tests | `contracts/test/Adversarial.test.ts` (exact names below) | `npm run test:contracts` |
| R14 | AI proposes a checklist with ambiguities | `server/` extract (Ollama / Gemini / rules) + shared validator | agreement wizard, step 2 |
| R15 | A person confirms; ambiguities resolved | Confirm stays locked until every blocking issue is edited or removed | wizard, step 3–4; gate tests |
| R16 | AI output never written directly | type boundary `ProposedChecklist` → `ConfirmedChecklist`; `deployVault()` only accepts the latter, and the compiler enforces it (`web/src/lib/deploy.boundary.ts`) | code walk-through |
| C1 | AI used meaningfully | extraction + ambiguity classification, checked by a deterministic validator | **evaluation still to do** (see Status) |
| C2 | Local fallback | rules extractor, local Hardhat, bundled fonts | Wi-Fi off; the browser e2e checks every request stays on `127.0.0.1` |
| C3 | Reproducible live testing | `npm run demo:reset`, seeded demo vault, Attack Lab | click it yourself |
| C4 | Fictional data | `samples/` only | no real people, money, networks or systems |

## Test results (all re-run for this README)

| Suite | Result |
|---|---|
| Contracts (Hardhat) | **138 passing**, 0 failing, 0 pending |
| Shared (vitest) | **123 passing** |
| Server (vitest) | **42 passing** |
| Web (vitest) | **65 passing** |
| Browser walks (real Chrome) | wizard (rules, and live-LLM mode), vault (seeded and freshly created), Attack Lab ×3 in a row: all passing |
| Coverage, `MilestoneVault.sol` | **100%** lines · **98.15%** branches · **100%** functions (the two uncovered branches are unreachable defensive underflow guards in `reconcile()`) |
| Invariant fuzz | 5 seeds × 200 steps = 1,000 steps over 21 vaults; 401 succeeded, 599 reverted with 13 distinct custom errors; every revert decoded to a vault error (no panics, no empty reverts); invariants I1–I8 asserted after every step; failed calls left storage identical |

The four booklet-required tests exist by these exact names (`contracts/test/Adversarial.test.ts`):
- `rejects a second release attempt`
- `rejects an unauthorized refund`
- `rejects an out-of-order transition`
- `blocks a re-entrancy attack`

## How the AI is used (and where it stops)

```
 agreement text ─▶ extractor (Ollama │ Gemini │ rules) ─▶ ProposedChecklist  (amber, never trusted)
                                                              │
                          deterministic validator (arithmetic in wei, parties, grounding) 
                                                              ▼
                       a person edits / removes / acknowledges every flag ─▶ the gate re-derives what must be resolved
                                                              ▼
                                  ConfirmedChecklist ─▶ canonical JSON ─▶ keccak256 ─▶ on-chain agreementHash
                                                              ▼
                                        both parties sign that hash before funding
```
- **The model proposes, the rules decide.** After parsing, the server overwrites severity, ids and objectivity with its own rules; amounts must literally appear in the text ("grounding"); sums are recomputed. A caller cannot skip the gate by sending an empty ambiguity list.
- **Blocking issues must be fixed, not acknowledged.** Warnings may be acknowledged with a note.
- **Verify any time.** The vault screen re-hashes the stored terms in your browser and compares them with the chain. Edit one character and the seals differ.
- **Measured, honestly.** One live run of `qwen2.5:7b-instruct` on the KrishiLens sample found the right parties, amounts and deadlines, and added two flags the rules do not raise, one of them a false positive that a person then has to resolve (cold call 25–27 s). A full evaluation over labelled samples is **not done yet**.

## Attack Lab

Every row is a real transaction from a sandbox account to a fresh vault built just for that row. Refused calls are never mined, so they cost no gas and change nothing.

| Attack | Contract's answer | Proven in tests |
|---|---|---|
| ★ Release the same milestone twice | `InvalidMilestoneState` | `rejects a second release attempt` |
| ★ Refund without being the arbiter (client, then stranger) | `NotArbiter` | `rejects an unauthorized refund` |
| ★ Act out of order (approve unsubmitted work; skip ahead) | `InvalidMilestoneState`, `MilestoneOutOfOrder` | `rejects an out-of-order transition` |
| ★ Re-enter `withdraw` from a malicious provider contract | re-entries blocked by the guard; paid exactly what was owed | `blocks a re-entrancy attack` |
| Approve a swapped deliverable | `DeliverableHashMismatch` | `rejects approval of a swapped deliverable` |
| Provider approves their own work | `NotClient` | access-control table test |
| Arbiter rules on an undisputed milestone | `InvalidMilestoneState` | state-machine table test |
| Wrong funding amount, or funding twice | `WrongFundingAmount`, `WrongAgreementState` | `rejects wrong funding amounts…`, `rejects funding twice` |
| Send ETH straight to the vault | `DirectPaymentNotAccepted` | `rejects direct ETH transfers, with or without calldata` |
| Force ETH in with `selfdestruct` | absorbed as surplus; cannot be withdrawn | `keeps the books reconciled and the surplus visible…` |
| Escalate before the review window ends | `ReviewWindowOpen` | `rejects early escalation until the review window has elapsed…` |
| Withdraw with nothing owed | `NothingToWithdraw` | `rejects withdraw with no credit` |
| **Contrast:** the same re-entrancy against a naive escrow | **drains 3.000 ETH of other users' money** | `naive escrow is drained by the same attack pattern (contrast)` |

The contrast row is the point: the attacker is real, it succeeds against a contract without the protections, and it fails against this one.

## Related work (what we borrowed, what is new)

We borrowed the role model (Trustless Work), the submit-proof step (Boundless), dual signing before funding (Fhenix Escrow), per-milestone conditions (ArbiSecure), reentrancy hardening and the "every stage on-chain" principle (Agent Escrow, ✅ 1st place at its hackathon), the "found an attack, fixed it" story (Gig-Escrow) and the idea of binding an approval to an exact digest (the booklet's ActionGate problem). Where we differ on purpose: a review-window timeout **escalates to the arbiter** instead of auto-paying, and AI is advisory only (we reject AI-triggered release, unlike TaskLoop). Full table with honest status labels and sources: [`docs/03-REFERENCES.md`](docs/03-REFERENCES.md).

What we believe is new in combination: (1) the **ambiguity gate** with co-signed terms hashes, (2) **hash-bound approval**, (3) a **clickable Attack Lab with a naive-escrow contrast**, (4) **live reconciliation** that reports force-sent ETH as surplus.

## Limitations (and what we would build next)
- One contract instance per agreement (a factory is the obvious next step).
- The arbiter is trusted; the arbiter can never be paid (invariant I8) but can decide a dispute either way.
- No partial release inside a milestone; amounts are whole-milestone.
- File hashing proves **identity, not quality**: it shows the approved file is the submitted file.
- Test ETH on a local chain only. The demo accounts are Hardhat's public keys, so they must never hold real funds.
- AI quality: a local 3B–7B model misses and over-flags; the validator and the human gate exist because of that. The labelled evaluation is not run yet.
- `escalate` uses checked arithmetic on `completedAt + reviewWindow`; an absurdly large review window would panic instead of reverting with a custom error (see `docs/PROGRESS.md`, open questions).

## Status
Built and verified: contract, tests and fuzz, shared hashing/validator/gate, AI service with fallbacks, agreement wizard, vault dashboard, Attack Lab, `npm run dev`, offline behaviour.
**Not done yet:** the labelled AI evaluation (`npm run eval:ai`, needs the teammate's sample agreements), the stretch features, and the final judge-style audit. An optional MST testnet network entry exists in `contracts/hardhat.config.ts` (enabled only when `DEPLOYER_KEY` is set); the local chain remains the default and the offline fallback.

## Repository map
`contracts/` Solidity + Hardhat tests · `shared/` types, canonical JSON, hashing, validator, gate · `server/` AI service (never touches the chain) · `web/` the app and browser tests (`web/e2e/`) · `samples/` fictional agreements and demo files · `docs/` spec, plan, UX, progress log.

## Team and data notice
Built for VORTEXA 3.0 by Omkar Rane (builder) and a teammate (research, scenarios, pitch). Every name, organisation, agreement and amount in this repository is fictional. No real money, real people, public networks or live third-party systems are involved.
