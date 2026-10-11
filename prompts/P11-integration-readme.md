# P11 — Integration pass, demo reset, offline check, README
**Depends on:** P09 (P10 optional) · **Time box:** 60 min

## Paste this
````text
Read docs/01-PROBLEM.md (traceability matrix), docs/03-REFERENCES.md and docs/06-DEMO-SCRIPT.md.

1. Full rehearsal: run `npm run demo:reset`, then execute every step of the demo script in docs/06 yourself (scripted where possible). Log each step as PASS/FAIL in PROGRESS.md and fix every FAIL. Then repeat with AI_MODE=rules and Ollama stopped (offline rehearsal).
2. Offline audit: grep web/ and server/ for http(s):// URLs used at runtime (fonts, CDNs, analytics). Only localhost, Ollama and the optional Gemini endpoint are allowed. Remove the rest.
3. `npm run dev` must start chain + server + web together, run deploy:demo once the chain is up (wait-on or a retry loop), and print one friendly line with the URLs.
4. Demo assets: create samples/demo-files/m1-report.pdf and m1-report-v2.pdf (tiny different PDFs or text files renamed .txt if PDF generation is a hassle) for the swapped-deliverable step.
5. README.md at the root (this is what judges read first; keep it scannable):
   - one-line pitch + a 3-layer diagram (ASCII or mermaid)
   - "Requirement → proof" table (copy and update the traceability matrix from docs/01)
   - Quick start on Windows (exact commands, including `ollama pull`), plus "Offline mode"
   - Test results: the exact test count, the four booklet-required test names, coverage numbers, the invariant fuzz summary (steps/seeds)
   - AI: how it's used, the boundary (proposed → validated → confirmed → hashed), and the EVAL-RESULTS headline numbers with a link
   - Attack Lab: the list of attacks and what each proves
   - Related work: a short version of docs/03 (what we borrowed, what's new). Use honest status labels.
   - Limitations (from docs/06) and what we'd build next
   - Team and the fictional-data notice
6. Final run: `npm run test:contracts`, `npm run coverage`, shared + server vitest, `npm run eval:ai`. Paste the summary numbers into README and PROGRESS.

Commit "P11: integration, offline check, README". Tag v1.0-demo.
````

## Acceptance checks
- [ ] Both rehearsals (online and offline) pass every step
- [ ] The README's numbers match the latest test and eval runs
- [ ] `git tag` shows `v1.0-demo`
