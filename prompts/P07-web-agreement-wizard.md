# P07 — Web app shell + Agreement wizard
**Depends on:** P04 (generated ABIs) · **Time box:** 90 min · **Use plan mode first** · Can run in parallel with P05 (mock the server until it exists)

## Paste this
````text
Read CLAUDE.md, docs/05-AI-SPEC.md, docs/06-DEMO-SCRIPT.md (steps 1–5) and, most importantly, docs/08-UI-UX.md. Then open docs/ui-prototype/index.html. It is the visual reference: match its tokens, type, layout, components, copy and interactions. Don't invent a different look. Build the web app shell and the Agreement wizard in web/.

Design system first (web/src/ui/):
- Copy the CSS tokens (light + dark + presenter mode) from the prototype into web/src/ui/tokens.css.
- Install fonts locally so the app works offline: @fontsource-variable/public-sans and @fontsource/ibm-plex-mono. Import them in main.tsx. No CDN links.
- Port the prototype's seal() into a React component HashSeal (real hashes now, not fakeHash), plus HashText, Amount (bigint wei → "1.000 ETH"), RoleChip, StateBadge, StateTrack, AmbiguityCard, GateBar, ActionSheet, RevertNotice and Toast, exactly as listed in docs/08 "Components".
- Put the copy deck from docs/08 into web/src/ui/copy.ts (error name → title + detail template). decodeRevert uses it.

App shell (web/src/):
1. lib/chain.ts: JsonRpcProvider(RPC_URL from deployment.json); getSigner(index) using Hardhat's unlocked accounts; decodeRevert(err, iface) → { name, args, title, detail } using copy.ts.
2. lib/api.ts: typed client for the server routes from P05. Use @mv/shared types and validate responses with zod.
3. Top bar exactly as in the prototype: brand seal, nav, AI pill (a dropdown for auto / ollama / gemini / rules, showing which source actually answered), chain pill (live block number), the "Acting as" role switcher (keys 1–4, each with name, role, short address and balance on hover), Presenter toggle (P) and Theme toggle (T).
4. Routes: /agreement (wizard), /vault/:address (P08), /attack-lab (P09), / (home: start a new agreement, or open the pre-seeded vault from deployment.json).

Agreement wizard (/agreement), a 6-step stepper with state kept in a reducer:
1. Input: textarea + "Load sample" dropdown (GET /api/samples).
2. Proposal: POST /api/extract. Two panes: left = source text with each ambiguity's quote highlighted (amber, numbered); right = the proposed checklist (parties, milestones, amounts, conditions, deadlines) in amber with a "Proposed by <source>" badge, latency and fallbackReason if any.
3. Resolve: a list of ambiguity cards (type, severity, quote, question, suggested resolutions). Each card has an inline editor for the related field (amount, condition text, deadline, party), an action selector (edited / acknowledged / clause-removed) and a required note. Edited values turn blue. Re-validate via POST /api/validate (debounced) and also locally with the shared validator. New ambiguities created by edits appear immediately. A progress meter shows "N of M resolved".
4. Confirm: assign addresses (default: client=#0, provider=#1, arbiter=#2), reviewWindow (default 120 s, for the demo). The Confirm button stays disabled with an explicit list of unmet gate conditions (computed by the shared gate). On click: POST /api/confirm → show the canonical JSON (collapsible) and agreementHash in green.
5. Deploy: deploy MilestoneVault with ContractFactory (generated ABI/bytecode) from the client account, args from the ConfirmedChecklist ONLY (write a function deployVault(confirmed: ConfirmedChecklist, agreementHash) that never accepts a ProposedChecklist). The vault starts in AwaitingSignatures.
6. Sign & fund: "Sign as Client" and "Sign as Provider", each sending sign(agreementHash) from that account, showing the hash being signed and the tx. Then "Fund as Client" sends exactly totalAmount (disabled until both have signed). Then navigate to /vault/:address.

Visibly label the AI boundary in step 4: "Everything above was proposed by AI and edited by people. Only this confirmed, hashed version can be deployed."

Error handling: every failed tx shows the decoded custom error in a red toast plus inline. If the server is down, show a clear banner and let the user continue with the in-browser rules extractor (import it from shared/ if feasible; otherwise show "server offline").

Run `npm run dev`, walk through the whole wizard with the KrishiLens sample in both "ollama" and "rules" modes, and fix anything broken. Record any rough edges in PROGRESS.md. Commit "P07: app shell + agreement wizard".
````

## Acceptance checks
- [ ] The KrishiLens text goes from paste to a funded vault, with Confirm locked until every ambiguity is resolved
- [ ] Rules mode works with the AI server's Ollama stopped
- [ ] The deploy function signature takes `ConfirmedChecklist` (check the code)
- [ ] Put the real app and `docs/ui-prototype/index.html` side by side. The Resolve and Confirm screens should look like the same product
- [ ] It works with Wi-Fi off (fonts are bundled locally)
