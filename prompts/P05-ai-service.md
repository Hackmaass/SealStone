# P05 — AI extraction service, validator and the confirmation gate
**Depends on:** P04 · **Time box:** 100 min · **Use plan mode first** · Can run in parallel with P07 (different folders)

## Paste this
````text
Read CLAUDE.md and docs/05-AI-SPEC.md fully. Build the AI pipeline. Shared logic goes in shared/ (the web uses the same validator), and provider code goes in server/.

shared/src/:
1. schema/proposed.ts: zod for ProposedChecklist and Ambiguity, plus the AmbiguityType enum, exactly per the spec. Also a JSON Schema export of ProposedChecklist (hand-written or via zod-to-json-schema) for Ollama's `format` field.
2. validate/lexicon.ts: vague words, subjective-approval patterns, conditional-amount patterns, auto-transition patterns (from the spec, plus sensible extras). Keep the lists short and readable; judges may read them.
3. validate/validator.ts: validate(proposed, sourceText) → { ambiguities: Ambiguity[] (origin "validator"), hardErrors: string[] } implementing V1–V11. Use ethers parseEther for amounts (exact, no floats). Grounding: the amount string must occur in sourceText (normalize "2.5 ETH" / "2.50 eth"); quotes must be substrings (case-insensitive, whitespace-normalized).
4. validate/merge.ts: mergeAmbiguities(ai, validator) with dedupe on (type, milestoneIndex); the validator's severity wins; the validator never removes AI flags; stable ids.
5. gate.ts: assertConfirmable({ edited checklist, ambiguities, resolutions, addresses, reviewWindowSeconds, sourceText, extraction }) → returns a ConfirmedChecklist, or throws a GateError listing every unmet condition (rules 1–4 in the spec, including re-running the validator on the edited checklist). This is the ONLY function that produces a ConfirmedChecklist.
6. vitest tests: each validator rule (positive + negative), merge behaviour, the gate rejecting each condition separately, the gate accepting a fully resolved KrishiLens case, and "acknowledged is not enough for blocking".

server/src/:
7. ai/rules.ts: deterministic extractor. Parse "Client:/Provider:/Arbiter:" lines (and variants like "Funder", "Mentor (arbiter)"), "Milestone N" / "M1" headings, amounts like "1.5 ETH", bullet conditions, dates (ISO and "15 Nov 2026"), and a "Total:" line. Output a valid ProposedChecklist with source "rules" and ambiguities from the lexicon.
8. ai/prompt.ts: system prompt + one fictional worked example per the spec.
9. ai/ollama.ts, ai/gemini.ts: as in the spec (timeouts, temperature 0, JSON mode). Gemini is only enabled when GEMINI_API_KEY is set; use plain fetch with no SDK.
10. ai/index.ts: extract(text, mode) with auto selection, zod parse, one retry with the error appended, then fallback to rules. It returns { proposed, source, model, latencyMs, fallbackReason }. ALWAYS run validator + merge on the result, whatever the source.
11. Routes:
    - GET  /api/health → { ok, providers: { ollama: bool, gemini: bool, rules: true }, models }
    - POST /api/extract { text, mode } → { proposed, ambiguities (merged), hardErrors, meta }
    - POST /api/validate { checklist, sourceText } → re-validation for live editing
    - POST /api/confirm { ...gate inputs } → { confirmed, agreementHash, canonical }, saves server/data/agreements/<hash>.json; a GateError → 422 with the list
    - GET  /api/agreements/:hash → the stored confirmed JSON
    - GET  /api/samples → lists samples/agreements/*.txt with their contents
12. samples/agreements/krishilens.txt: the fictional KrishiLens agreement with the 5 deliberate ambiguities from docs/02 and docs/06 (if the teammate hasn't written it yet, draft it and mark it "draft" in PROGRESS.md).
13. Tests (vitest): the rules extractor on krishilens.txt finds all 3 milestones, the amounts, and at least the AMOUNT_MISMATCH, CONDITIONAL_AMOUNT, SUBJECTIVE_APPROVAL and MISSING_DEADLINE flags; the extract route falls back to rules when Ollama is unreachable (mock fetch); /api/confirm returns 422 for unresolved blocking issues.

Hard rule to keep visible in code: there is no route or function that sends a transaction. The server never touches the chain. Add a comment at the top of server/src/index.ts saying so.

Run all tests (shared + server). Try a real extraction with Ollama if it's available and record latency + result quality in PROGRESS.md. Commit "P05: AI extraction, validator, confirmation gate".
````

## Acceptance checks
- [ ] With Ollama stopped, `/api/extract` still returns a checklist with `source: "rules"` and a `fallbackReason`
- [ ] With Ollama running, `source: "ollama"`, and the validator's flags are still merged in
- [ ] `/api/confirm` returns 422 with a readable list until everything is resolved
- [ ] You can explain in one sentence why the AI can't change an amount (grounding + validator + gate)
