# 02 — Implementation plan

## The idea in one paragraph
Most teams will build one trust layer, safe funds. MilestoneVault builds three, and every one can be broken live by a judge.
- **Agreement integrity:** money can't be committed until the terms are unambiguous and both sides have signed the same hash.
- **Deliverable integrity:** approval binds to the exact file that was reviewed.
- **Fund integrity:** the contract survives real attacks while its books visibly balance.

## Demo scenario (fictional)
**Campus Incubation Cell** funds the student startup **"KrishiLens"** (crop-disease photo app) with **5 test-ETH** across 3 milestones.
- **Client:** the Incubation Cell. **Provider:** the KrishiLens team. **Arbiter:** a faculty mentor, fixed at deployment.
- **M1** Problem validation report, 1.0 ETH. **M2** Working prototype (git commit hash as the deliverable), 2.5 ETH. **M3** Pilot with 20 farmers + report, 1.5 ETH.
- The agreement prose deliberately contains ambiguities:
  - "to the mentor's satisfaction"
  - "remaining funds after M1 and M2" (a derived amount)
  - no deadline on M3
  - a bonus clause, "0.5 ETH extra if delivered early", that makes the total unclear

## Architecture
```
 agreement.txt ──► server/ (Express :8787)
                     ├─ extract: Ollama │ Gemini │ rules  ──► ProposedChecklist (+ ambiguities)
                     ├─ validate: deterministic rules     ──► extra ambiguities, hard errors
                     └─ hash: canonical JSON → keccak256
                                   │
              web/ (React :5173) ◄─┘
                ├─ Agreement wizard: paste → propose → resolve every ambiguity → confirm
                │      → deploy → client signs hash → provider signs hash → fund
                ├─ Milestones: role switcher, actions, deliverable hashing, event timeline
                ├─ Ledger: reconcile() panel (deposited / released / refunded / withdrawn / held / balance)
                └─ Attack Lab: sandbox vault + attacker contracts, expected vs actual revert
                                   │ ethers v6 JSON-RPC
              contracts/ (Hardhat node :8545)
                ├─ MilestoneVault.sol         (the product)
                ├─ attack/ReentrantProvider.sol, attack/ForceSender.sol
                └─ attack/NaiveEscrow.sol + NaiveDrainer.sol   (contrast only, never "the product")
```

## Build order and 12-hour schedule (one builder with Claude Code; teammate in parallel)

| Time | Builder (Claude Code prompts) | Teammate |
|---|---|---|
| 0:00–0:30 | P00 bootstrap | Write the KrishiLens agreement + 7 more sample agreements with labelled ambiguities (`samples/`) |
| 0:30–2:30 | P01 contract core → P02 core tests | Read docs/01; prepare the pitch skeleton |
| 2:30–3:45 | P03 attack contracts + invariant test | Collect the README "related work" table from docs/03 |
| 3:45–4:15 | P04 deploy + seed + ABI export | Manual-test the contract via the Hardhat console using the checklist in P02 |
| 4:15–6:00 | P05 AI service (second terminal can start P07 in parallel) | Run Ollama; try sample texts; log misses |
| 6:00–6:30 | P06 AI eval | Fix the sample labels |
| 6:30–9:00 | P07 wizard → P08 dashboard + ledger → P09 Attack Lab | Click-test every flow; file bugs in PROGRESS.md |
| 9:00–10:00 | P10 stretch (only if P00–P09 are green) | Draft slides from 06-DEMO-SCRIPT |
| 10:00–11:00 | P11 integration, demo reset, README | Rehearse the demo twice with a timer |
| 11:00–11:45 | P12 judge-proof audit and fixes | Rehearse Q&A from 06-DEMO-SCRIPT |
| 11:45–12:00 | Freeze. Tag. Run `demo:reset`. | — |

**Parallel sessions:** P05 (`server/`) and P07 (`web/`) touch different folders and can run in two Claude Code terminals at once after P04. Don't run two sessions on `contracts/` at the same time.

## Cut order (if the clock slips, cut from the bottom)
1. **Core, must ship:** state machine, roles, pull payments, the 4 required attack tests, reconciliation (P01–P04)
2. **Headline:** deliverable-hash binding, AI checklist + ambiguity gate + fallback, agreement hash on-chain + dual signing (P01, P05, P07)
3. **Demo multipliers:** Attack Lab UI, randomized invariant test, AI eval numbers (P03, P06, P09)
4. **Borrowed upgrades:** timeout escalation to the arbiter, naive-escrow contrast (P01, P03)
5. **Stretch:** arbiter evidence brief, git-commit deliverables, VaultFactory (P10)

Layers 1+2 alone already beat a plain escrow. Never trade layer 1 quality for anything below it.

## What makes this hard to beat
- **A judge can't break it.** Every "what if…" has an Attack Lab button with a decoded revert reason.
- **The innovation can be demonstrated, not just claimed.** The swapped-deliverable revert and the ambiguity gate can be shown live in 20 seconds each.
- **AI with honest numbers.** The eval shows ambiguity-detection recall for the LLM vs rules-only, on fixed samples.
- **The AI boundary is visible:** proposed (amber) → validated → human-confirmed (green) → hashed → on-chain. The UI never blurs these.
