# 06 — Demo script, pitch and judge Q&A

## 30-second pitch
"Milestone escrow fails in three ways: unclear terms, swapped deliverables and buggy money code. Most escrow projects fix only the last one. Sealstone closes all three:
1. AI flags every ambiguity in the agreement, and money can't be locked until a human resolves each one and both sides sign the same hash.
2. Approval binds to the exact deliverable hash, so a swapped file can't be paid for.
3. The contract survives real attacks while its books visibly balance. Click any attack yourself."

## Live demo (target 5 minutes, rehearse with a timer)
| # | Time | Do | Say |
|---|---|---|---|
| 1 | 0:00 | Paste the KrishiLens agreement → **Extract** | "The AI proposes a checklist. It never touches the chain." |
| 2 | 0:30 | Show 5 amber ambiguities with quotes ("to the mentor's satisfaction", "remaining funds", bonus clause, no M3 deadline, total mismatch) | "Each is a future dispute. The Confirm button is locked." |
| 3 | 1:00 | Toggle AI to **rules / offline** → extract again | "Same gate with Wi-Fi off. That's the required local fallback." |
| 4 | 1:20 | Resolve each one (edit amounts, replace 'satisfaction' with 'demo of 3 detections ≥80% confidence', add a deadline, remove the bonus) → validator turns green → **Confirm** | "Edits are re-validated. Acknowledging isn't enough for blocking issues." |
| 5 | 2:00 | Deploy → client signs hash → provider signs hash → fund 5 ETH | "Both parties sign the same agreement hash on-chain before any money locks." |
| 6 | 2:30 | Provider uploads `m1-report.pdf` → **Mark complete** (hash shown) | "Completion commits the file's SHA-256." |
| 7 | 2:50 | Swap the file to `m1-report-v2.pdf` → client **Approve** → revert `DeliverableHashMismatch` | "Approval binds to exactly what was reviewed." |
| 8 | 3:10 | Approve the correct file → provider **Withdraw** → ledger stays green | "Pull payments. The books reconcile after every action." |
| 9 | 3:30 | M2: client **Disputes** → arbiter **Refunds** with a rationale | "Only the arbiter decides disputes." |
| 10 | 3:50 | **Attack Lab** → run all → every row PASS with decoded revert | "Second release, unauthorized refund, out-of-order, re-entrancy, swapped deliverable, wrong funding, forced ETH." |
| 11 | 4:30 | Run re-entrancy against **NaiveEscrow** → drained | "Same attacker drains a naive contract, so the attack is real, and ours blocks it." |
| 12 | 4:45 | Show `npm run test:contracts` + coverage + the AI eval table | "Every guarantee has a test, and here's how well the AI actually does." |

**Wi-Fi off:** before turning the Wi-Fi off, set the AI selector (top bar) to **Rules (offline)**. Extraction already falls back by itself, but with the selector on Auto the assistant, the evidence brief and the approval review first try Sarvam and wait up to 8 s before the built-in rules answer. In Rules (offline) they answer instantly and nothing leaves the machine.

**Optional AI extras (advisory, never decide anything)**
- *Assistant* (the "Ask" button, bottom right): "What's next for me?" It suggests a button to click; it never moves money. Try "approve milestone 1 for me": it explains that only the confirmation sheet can do that.
- *Approval review* (client, in the Approve sheet, after step 6): open "Check the work against what was agreed", click "Use the demo report's text", then "Check against the conditions": all three milestone-1 conditions show as appearing addressed. The seal comparison proves it is the same *file*; this only helps judge the *work*.
- *Arbiter evidence brief* (step 9, before ruling): the client's dispute reason should talk about the conditions, e.g. **"The report we received is only 6 pages long and covers interviews with just 7 farmers. It lists three diseases, not a ranking of the five most common ones."** The arbiter opens "Evidence brief", pastes the provider's side, e.g. **"The report runs to 9 pages. We interviewed 12 farmers across three villages. Section 3 ranks the five most common crop diseases by how often farmers reported them."**, and gets each condition marked contested with a quote from each side. Then the arbiter rules with the normal Release / Refund buttons.
- Say it plainly: the AI reads, the quotes are checked word for word by code, and the arbiter decides.

**Invite the judge:** "Pick any role and try to steal money." The role switcher and Attack Lab make this safe.

## Likely judge questions → answers
- **"Isn't hashing the deliverable trivial?"** The hash is easy. The guarantee is the point: the approval is bound to a specific artifact, which is how code review and signed releases work. Without it, "approved" is ambiguous after the fact.
- **"What if the client never responds?"** After the review window, the provider can escalate to the arbiter. It's an explicit transition, not an auto-release, because the booklet rejects undefined transitions. (Agent Escrow auto-pays; we chose escalation deliberately.)
- **"What stops the AI from changing amounts?"** Three layers: the grounding check (amounts must appear in the text), validator arithmetic in wei, and the human confirmation gate. Deploy only accepts the `ConfirmedChecklist` type.
- **"Can the arbiter steal funds?"** No. The arbiter can only move a *disputed* milestone's amount to the client or the provider, and can never receive credit (invariant I8).
- **"What if someone force-sends ETH?"** It shows up as surplus in reconciliation, can't be withdrawn, and doesn't break the books. Tested with `ForceSender`.
- **"Why not push payments?"** A provider that is a malicious contract could block or re-enter. Pull payments + CEI + `nonReentrant` isolate each withdrawal.
- **"How good is the AI?"** Show `docs/EVAL-RESULTS.md`: recall per ambiguity type, LLM vs rules, misses included.
- **"Limitations?"** Single-agreement contract (factory is a stretch), the arbiter is trusted, there's no partial release within a milestone, test-ETH only, and file hashing proves identity, not quality.

## Pre-demo checklist
- [ ] `npm run demo:reset` succeeds; ledger green
- [ ] Ollama running and model pulled (`ollama list`); rules mode also tested
- [ ] Wi-Fi off rehearsal done once
- [ ] Browser zoom 110%, dark/light chosen, notifications off
- [ ] Demo files ready: `m1-report.pdf`, `m1-report-v2.pdf`
- [ ] Terminal with `npm run test:contracts` output ready in a second tab
