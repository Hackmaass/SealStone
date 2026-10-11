# How to run these prompts in Claude Code

1. Open a terminal in `D:\Projects\Vortexa_3.0` and run `claude`. `CLAUDE.md` loads automatically.
2. Run the prompts **in order**. Each file has:
   - a **Paste this** block: copy everything inside the fence into Claude Code
   - **Acceptance checks** that you verify yourself before moving on
3. Use **plan mode** (Shift+Tab until it says plan mode) for P01, P05, P07 and P09. Read the plan, correct it, then approve.
4. Run `/clear` between prompts to keep the context small. `CLAUDE.md` and `docs/PROGRESS.md` carry the state forward.
5. Commit after every prompt whose acceptance checks pass. The prompts end with a commit step.

## Order and timing
| File | Time box | Can run in parallel with |
|---|---|---|
| P00-bootstrap.md | 30 min | — |
| P01-contract-core.md | 60 min | — |
| P02-core-tests.md | 60 min | — |
| P03-attacks-invariants.md | 75 min | — |
| P04-deploy-seed.md | 30 min | — |
| P05-ai-service.md | 100 min | P07 (a second terminal) |
| P06-ai-eval.md | 30 min | P07/P08 |
| P07-web-agreement-wizard.md | 90 min | P05 |
| P08-web-milestones-ledger.md | 75 min | P06 |
| P09-web-attack-lab.md | 60 min | — |
| P10-stretch.md | 60 min | only if P00–P09 are ✅ |
| P11-integration-readme.md | 60 min | — |
| P12-judge-proof-audit.md | 45 min | — |

If you fall behind: skip P10 entirely, shrink P09 to the four booklet attacks plus the swapped deliverable, and keep P11 and P12. Never skip P12.

## Utility prompts
- `FIX.md`: paste when something breaks
- `RESUME.md`: paste at the start of a new session or after `/clear` if you lose track
