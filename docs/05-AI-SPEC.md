# 05 — AI specification

## Where AI is used (and where it is not)
| Used for | Not used for |
|---|---|
| Turning agreement prose into a **proposed** checklist (parties, milestones, amounts, conditions, deadlines) | Writing anything to the contract |
| Classifying **ambiguities** by type, with the quote that caused each one | Deciding whether money moves |
| (Stretch) An **arbiter evidence brief**: lining up each side's claims against each condition | Recommending a ruling |

The pipeline: **AI proposes → deterministic validator checks → human resolves and confirms → canonical JSON → keccak256 → both parties sign the hash on-chain → deploy.**

## Provider selection (`server/src/ai/`)
`mode = auto | ollama | gemini | rules` (UI dropdown + `AI_MODE` env)
- **auto:** Ollama if `GET :11434/api/tags` answers within 1.5 s → else Gemini if `GEMINI_API_KEY` is set → else rules.
- **ollama:** `POST http://127.0.0.1:11434/api/chat`, `stream:false`, `format: <JSON schema>`, `options.temperature: 0`, timeout 30 s. Model `OLLAMA_MODEL` (default `llama3.2:3b`; `qwen2.5:3b` is a good alternative for JSON).
- **gemini:** REST `generateContent` with `responseMimeType: "application/json"`. Model from `GEMINI_MODEL` (keep it configurable; verify the name on the day).
- **rules:** regex/lexicon extractor, always available, deterministic.

Every LLM response is parsed with zod. On a parse failure: retry once with the zod error appended. If that fails too, fall back to rules and set `fallbackReason`. The response always reports `source`, `model`, `latencyMs` and `fallbackReason`.

## ProposedChecklist (zod: `shared/src/schema/proposed.ts`)
```ts
{
  schemaVersion: 1,
  source: "ollama" | "gemini" | "rules",
  title: string,
  parties: {
    client:   { name: string | null, quote: string | null },
    provider: { name: string | null, quote: string | null },
    arbiter:  { name: string | null, quote: string | null }
  },
  currency: string | null,              // expected "ETH" (test ETH)
  totalStated: string | null,           // decimal ETH as written, e.g. "5"
  milestones: Array<{
    index: number,                      // 0-based
    title: string,
    amount: string | null,              // decimal ETH as written; null if not stated
    conditions: Array<{ text: string, objective: boolean }>,
    deadline: string | null,            // ISO date if stated
    deliverableType: "document" | "code" | "other",
    quote: string                       // source span
  }>,
  ambiguities: Ambiguity[],
  confidence: number                    // 0..1, self-reported; display only
}

Ambiguity = {
  id: string,                           // stable: `${type}:${milestoneIndex ?? "agreement"}:${n}`
  origin: "ai" | "validator",
  type: AmbiguityType,
  severity: "blocking" | "warning",
  milestoneIndex: number | null,
  quote: string | null,                 // must be a substring of the agreement text
  message: string,                      // what is unclear
  question: string,                     // what the human must decide
  suggestedResolutions: string[]
}
```

## Ambiguity types
| Type | Severity | Example trigger |
|---|---|---|
| `MISSING_PARTY` | blocking | no arbiter named |
| `PARTY_CONFLICT` | blocking | the same person is both client and arbiter |
| `MISSING_AMOUNT` | blocking | "M2: payment on delivery" with no figure |
| `AMOUNT_MISMATCH` | blocking | milestones add up to 4.5 but the total says 5 |
| `CONDITIONAL_AMOUNT` | blocking | "remaining funds", "bonus if early", "10% of" |
| `AMOUNT_NOT_IN_TEXT` | blocking | the AI produced an amount that doesn't appear in the text (hallucination guard) |
| `VAGUE_CONDITION` | blocking if a milestone has no objective condition, otherwise a warning | "satisfactory", "good quality", "reasonable", "as needed", "ASAP" |
| `SUBJECTIVE_APPROVAL` | warning | "to the mentor's satisfaction" |
| `MISSING_DEADLINE` | warning | milestone without a date |
| `UNDEFINED_TRANSITION` | blocking | "funds release automatically if no reply" (the contract only allows defined transitions) |
| `CURRENCY_UNCLEAR` | blocking | "₹50,000 or equivalent" |

## Deterministic validator (`shared/src/validate/validator.ts`, so the server and the web run identical rules), which always runs, whatever the source
- **V1** All three parties present, else `MISSING_PARTY`. **V2** Names pairwise distinct, else `PARTY_CONFLICT`.
- **V3** 1–20 milestones. **V4** Every amount present, positive and parseable, else `MISSING_AMOUNT`.
- **V5** If `totalStated` is set: Σ amounts == total (exact decimal, compared in wei with `parseEther`), else `AMOUNT_MISMATCH`.
- **V6** Each milestone has ≥ 1 condition and ≥ 1 objective condition, else `VAGUE_CONDITION` (blocking).
- **V7** Lexicon scan of the conditions for vague and subjective words → `VAGUE_CONDITION` / `SUBJECTIVE_APPROVAL`.
- **V8** Conditional-amount patterns (`remaining`, `balance of`, `bonus`, `%`, `if … extra`) → `CONDITIONAL_AMOUNT`.
- **V9** Auto-transition patterns (`automatically`, `if no response`, `deemed approved`) → `UNDEFINED_TRANSITION`.
- **V10** **Grounding:** every non-null amount must appear in the source text; every `quote` must be a substring. A failed amount gives `AMOUNT_NOT_IN_TEXT`; a failed quote is replaced by `null` and noted.
- **V11** Missing deadline → `MISSING_DEADLINE`.

Merge the AI and validator ambiguities, dedupe on `(type, milestoneIndex)`, and keep the validator's severity when they disagree. **The validator can add or escalate, never remove** an AI flag.

## Resolution gate (enforced in both the server and the web)
`Resolution = { ambiguityId, action: "edited" | "acknowledged" | "clause-removed", note: string (≥ 5 chars), resolvedBy: "client" | "provider" }`

Confirm is enabled only when:
1. every ambiguity id has a resolution,
2. every **blocking** ambiguity is resolved by `edited` or `clause-removed` (acknowledging is not enough),
3. re-running the validator on the **edited** checklist produces zero blocking issues (an edit can create new ones; those must be resolved too),
4. wallet addresses are assigned to all three roles and are distinct.

## ConfirmedChecklist (`shared/src/schema/confirmed.ts`) is the only thing that can reach the chain
```ts
{
  schemaVersion: 1,
  title: string,
  parties: { client: { name, address }, provider: { name, address }, arbiter: { name, address } },
  milestones: Array<{ index, title, amountWei: string, conditions: string[], deadline: string | null, deliverableType }>,
  reviewWindowSeconds: number,
  resolutions: Resolution[],
  extraction: { source, model: string | null, sourceTextHash: string },  // keccak256 of the agreement text
  confirmedAt: string
}
```
`agreementHash = keccak256(utf8(canonicalJSON(confirmedChecklist)))`. Canonical JSON sorts keys recursively, has no whitespace, and keeps arrays in order. The confirmed JSON is saved to `server/data/agreements/<agreementHash>.json` so anyone can re-hash it with **Verify agreement**.

Type boundary rule: no function that deploys or sends a transaction may accept a `ProposedChecklist`. Only `ConfirmedChecklist` that passed `assertConfirmable()`.

## LLM prompt rules (`server/src/ai/prompt.ts`)
- System: "You extract a milestone escrow agreement into JSON matching this schema. Never invent amounts, names or dates: use null. Quote the exact source text. List every ambiguity using only these types: … Output JSON only."
- Include one short worked example (input text → JSON) built from fictional data.
- Temperature 0. Truncate input to 6,000 characters (warn the user if truncated).

## Evaluation (`npm run eval:ai`, writes `docs/EVAL-RESULTS.md`)
Over `samples/agreements/*.txt` with labels in `samples/expected.json`, for each source available (rules always; Ollama and Gemini if reachable):
- milestone count accuracy, amount exact-match rate, party extraction accuracy
- ambiguity recall and precision by type (match on `type` + `milestoneIndex`)
- mean latency

Report honestly, including the misses. The README cites this table.

## Stretch: arbiter evidence brief
`POST /api/arbiter-brief { conditions[], clientEvidence, providerEvidence }` → per condition: `{ condition, clientPoints[], providerPoints[], status: "supported" | "contested" | "not-addressed", quotes[] }`. Always labelled **"Advisory, not a ruling"**. There is no recommended outcome field by design. The rules fallback uses keyword overlap. The arbiter still clicks Release or Refund, and their rationale is hashed.
