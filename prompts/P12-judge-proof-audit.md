# P12 — Judge-proof audit (fresh eyes)
**Depends on:** P11 · **Time box:** 45 min · Run this after `/clear`

## Paste this
````text
You are a strict VORTEXA judge and a smart-contract auditor who has NOT seen this code being written. Your job is to find what would cost us points. Don't fix anything until you have written the report.

Read docs/01-PROBLEM.md (booklet text + traceability), docs/04-CONTRACT-SPEC.md, docs/05-AI-SPEC.md and README.md. Then inspect the code and run things.

Check and report in docs/AUDIT.md, as a table with Requirement · Evidence (file:line or command output) · Verdict (PASS / WEAK / FAIL) · Fix:
1. Every R1–R16 and C1–C4 row of the traceability matrix. Does the proof actually exist and work?
2. The four booklet test names exist verbatim and pass.
3. AI boundary: trace every path from server output to a transaction. Confirm that only ConfirmedChecklist (produced by assertConfirmable) reaches deploy. grep for any place that passes proposed data into contract calls.
4. Contract review against the spec: check order, CEI in withdraw, no credit path to the arbiter, terminal states immutable, every state change emits an event, receive/fallback revert, no unchecked/assembly/tx.origin. If slither is installed (`slither --version`), run it on contracts/ and triage the findings; if not, say so.
5. Undefined transitions: list every (function × state × role) combination the tests do NOT cover.
6. Reproducibility: clone the repo into a temp folder, run `npm run setup` and `npm run test:contracts` from scratch, and report any missing step.
7. Offline: with AI_MODE=rules, does the full wizard still work?
8. The demo script: any step that depends on luck (timing, network, Ollama speed)? Suggest a safer alternative.
9. The top 5 questions a judge is most likely to ask that our docs/06 doesn't answer yet.

Then fix every FAIL, and every WEAK that takes < 10 minutes. Re-run the tests. Update AUDIT.md with what was fixed and what remains (with an honest note), and add the new Q&A answers to docs/06.

Commit "P12: audit fixes".
````

## Acceptance checks
- [ ] `docs/AUDIT.md` has no FAIL rows left
- [ ] The fresh-clone test run works
- [ ] You and your teammate have read the new Q&A additions
