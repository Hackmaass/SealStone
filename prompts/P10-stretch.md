# P10 — Stretch features (only if P00–P09 are all ✅ and it's before hour 9)
**Depends on:** P09 · **Time box:** 60 min, hard stop

## Paste this
````text
Read docs/05-AI-SPEC.md, the "Stretch: arbiter evidence brief" section. Only do these in order, and stop at the 60-minute mark wherever you are. Each item must leave the app working.

1. Arbiter evidence brief
   - server: POST /api/arbiter-brief { conditions[], clientEvidence, providerEvidence, mode } → per-condition { condition, clientPoints[], providerPoints[], status: supported | contested | not-addressed, quotes[] }, with the same provider selection + zod + fallback pattern as extract. The rules fallback uses keyword overlap. Deliberately NO "recommended ruling" field in the schema.
   - web: on a Disputed milestone, the arbiter role sees "Generate evidence brief (advisory)". The provider can add their own evidence text there too. Show the brief with a permanent banner: "Advisory only — the arbiter decides; this text is not sent to the contract."
   - test: the schema has no ruling field; the rules fallback works offline.

2. Git-commit deliverables polish: in Mark complete, a "Git commit" tab accepts a 40-hex SHA; the deliverable hash = sha256(utf8("git:" + sha)). Document it in the UI tooltip and the README.

3. (Only if time remains) VaultFactory.sol: createVault(...) deploys a MilestoneVault and emits VaultCreated(vault, client, provider, arbiter, agreementHash); the home page lists vaults from those events. Add 2 tests. If this risks breaking anything, skip it and note "cut" in PROGRESS.md.

Commit after each item separately.
````

## Acceptance checks
- [ ] The brief works with Wi-Fi off (rules)
- [ ] There is nowhere in the code where the brief's output reaches `resolve`
