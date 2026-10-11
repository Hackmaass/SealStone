# 08 — UI/UX specification

> ## Superseded in part by the user's direction (2026-10-11): the "Lavender" visual language
> The user asked for the landing page to follow the layout and feel of a reference lending-app marketing site, and the dashboard/app to follow the layout of that product's web app (both only as *design references*: our own brand, copy, artwork and code; no third-party logos, fonts, images or CSS are used).
> **Where this section disagrees with the rest of this document, THIS section wins.** It replaces the "security paper" look, including its "Don'ts" (no gradients, no glass, soft shadows are now allowed).
>
> **What changed**
> - Surfaces: near-white cards on a faint lavender-grey page, large radii (16 px cards, 28 px hero panels, pill buttons), soft shadows, gentle lavender gradients on the landing page, one dark section.
> - Type: Inter (variable, bundled via `@fontsource-variable/inter`, OFL), tight bold display headings; IBM Plex Mono stays for hashes, addresses and amounts.
> - Accent: violet (`--accent`) for primary actions and links; light lavender (`--accent-wash`) for fills. The light violet is a FILL colour only; text uses the darker `--accent` so contrast stays >= 4.5:1.
> - Two layouts: the marketing landing page (`/`) and the app shell (everything else: top nav with Dashboard / Vaults / Agreement studio / Attack Lab, the "Acting as" switcher, the chain and AI pills).
> - The landing page's product visuals are real screenshots of this app (`npm run capture:landing`), never mock-ups.
>
> **What did NOT change (judges check these)**
> - State colours keep their meaning on every screen and always come with an icon or a word: green = on-chain / confirmed, amber = proposed by AI, blue = edited by a person, red = reverted / blocked, grey = not yet. **Never show an AI-proposed value in green.**
> - Hash seals stay the signature element (`HashSeal`); the hex is always shown beside them.
> - Text contrast >= 4.5:1, visible focus ring, minimum 36 px hit targets, `prefers-reduced-motion` respected, works at 1366x768 / 110% zoom and in presenter mode.
> - Everything works offline: no external fonts, images, scripts or links at runtime.
> - Only checkable facts on the landing page (counts that come from the test runs), fictional data only, no invented partners, testimonials, user counts or TVL.
>
> The sections below describe the OLD tokens and look; keep them for the information architecture, role journeys, states and copy deck, which still apply.


Build target for P07–P09. The clickable reference is `docs/ui-prototype/index.html`. Open it in a browser and match it.

## The brief in one line
Make trust **visible**: at any moment a judge should be able to see *who can do what next*, *what the AI proposed vs what people confirmed*, and *that the money adds up*, without reading a hash.

- **Audience:** judges watching on a projector (1366×768 at 110% zoom), then clicking themselves. Secondary: the three parties.
- **Primary job:** show that the contract's rules hold, and show it in the time a judge spends glancing at the screen.

---

## Reference board: what we take from whom

| Reference | What it does brilliantly | What we take | Where it shows up |
|---|---|---|---|
| **GitHub PR reviews + "dismiss stale approvals"** | An approval belongs to a specific commit; pushing a new commit dismisses it | Approval belongs to one exact deliverable. The UI says "You're approving *this* file", with its seal | Approve dialog, swapped-file mismatch |
| **Spellbook / Grammarly** | Issues highlighted *inside* the document, with a side rail of cards you resolve one by one | Inline highlighted quotes in the agreement + a rail of ambiguity cards linked both ways | Wizard → Resolve |
| **DocuSign** | Clear signing order, "waiting for X", completed signatures stamped | Two signature slots with live status and a stamp when signed | Wizard → Sign & fund |
| **Safe{Wallet} transaction queue** | "1 of 2 confirmations", who has and hasn't signed, what happens next | Every milestone shows "Waiting for: Client" and the next allowed actions | Milestone rows |
| **Rabby pre-sign checks** | Before you sign, it shows what will happen and warns about risk in plain words | Pre-action preview: "This will release 2.5 ETH to KrishiLens. Seals match ✓" | Action confirmation sheet |
| **Tenderly debugger** | Failed transactions with the decoded revert reason, arguments and state diff | Reverted actions show the error in plain English + raw error + args, and no state changed | Toasts, timeline, Attack Lab |
| **Stripe balance / Mercury** | Calm money UI with tabular figures, clear "available / pending" buckets | The ledger as a balance equation with tabular numerals | Ledger panel |
| **Linear** | A small, consistent status-icon language, fast keyboard UX, quiet chrome | One state glyph set used everywhere; keyboard shortcuts for roles (1–4) | Everywhere |
| **Vercel deployment log** | A timeline that reads top-to-bottom like a story, with failed steps in place | Event timeline including rejected attempts | Vault → Activity |
| **Banknote security printing (guilloché)** | Fine-line patterns that make forgery obvious at a glance | **Hash seals**: a deterministic radial glyph per hash, so two different hashes *look* different | Every hash in the app |

Sources: [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) · [Spellbook in Word](https://spellbook.com/gpt4o-word) · [Tenderly debugger](https://docs.tenderly.co/debugger/execution-overview) · [Tenderly inspect transaction](https://docs.tenderly.co/developer-explorer/inspect-transaction) · [Rabby pre-sign simulation](https://dextools.io/news/what-is-rabby-wallet-pre-sign-simulator) · [Safe{Wallet}](https://safe.global/blog/safe-research-the-future-of-self-custody-wallets)

---

## Design direction: "security paper"

Escrow is a promise about money, so the UI borrows from the objects people already trust with money: banknotes, cheques and notarised documents. These are cool security-paper tones, deep ink, intaglio green, and fine-line seals. The look is calm and exact, with no glow and no gradients.

**Rejected first idea:** a dark "vault" theme with neon green. That's the default crypto look and would be indistinguishable from fifty other projects.

### The one bold thing: hash seals
Every hash (agreement, deliverable, evidence, rationale) is drawn as a **seal**: 64 radial strokes, one per hex digit, whose lengths come from the digit's value, around a small centre mark. It's deterministic and cheap to draw (SVG).
- Two identical hashes produce identical seals; different hashes look *obviously* different. This makes the swapped-deliverable moment visual: the two seals sit side by side and visibly don't match.
- The seal is coloured by state: amber outline = proposed, ink = submitted, green = on-chain / matched, red = mismatch.
- The hex is always available underneath (truncated `0x9f3a…c41e`, with copy and full-hash tooltip). The seal never replaces the hex.

Everything else stays quiet so the seals carry the personality.

### Tokens
```css
/* light (default) */
--paper:      #EDF0EA;  /* cool security-paper background */
--paper-2:    #F7F8F4;  /* raised surfaces */
--rule:       #C9D0C6;  /* lines, borders */
--ink:        #18212B;  /* text, primary */
--ink-2:      #4A5562;  /* secondary text */
--intaglio:   #0D5B49;  /* brand + "on-chain / confirmed" */
--proposed:   #A86A12;  /* AI proposed (amber) */
--human:      #2F56C9;  /* human edited (blue) */
--revert:     #B3261E;  /* reverted / blocked (red) */
--pending:    #8A949E;  /* not yet (grey) */
/* dark */
--paper:#10171F; --paper-2:#17212B; --rule:#2A3644; --ink:#E4E9E2; --ink-2:#A3AFB9;
--intaglio:#3FB28F; --proposed:#E0A43C; --human:#7FA1FF; --revert:#F2756B; --pending:#6E7A86;
```
The state colours mean the same thing on every screen and **always come with an icon or a word** (never colour alone).

### Type
- **Public Sans** (variable): all UI text. It was designed for public institutions, which suits "visible rules". Install with `@fontsource-variable/public-sans` so it's bundled and works offline.
- **IBM Plex Mono**: only for hashes, addresses and amounts, with tabular figures. Install with `@fontsource/ibm-plex-mono`.
- Scale (1.25 ratio, 16 px base): 12.8 · 14 · 16 · 20 · 25 · 31 · 39. Body 16/24. Line length ≤ 72ch.
- Sentence case everywhere. No all-caps labels, no tracked-out eyebrows.

### Shape and spacing
- 4 px grid. Radius: 4 px inputs/buttons, 8 px panels. Rows (milestones, attacks) are **ruled rows, not floating cards**; they sit on the panel and are separated by `--rule` lines.
- Shadows only on overlays (dialogs, toasts). Panels use a 1 px rule.
- Layout max width 1360 px. Main column + right rail (360 px) on desktop; the rail drops below on narrow screens.

### Motion (only where it shows what changed)
- A seal **draws in** (its strokes grow from the centre over 400 ms) when a hash is first committed on-chain. That's the single signature animation.
- Ledger numbers count to their new value (250 ms) after a transaction.
- A reverted action makes its row shake once (120 ms) and flash the red rule.
- Respect `prefers-reduced-motion` (instant changes).

---

## Information architecture
```
Top bar:  Sealstone | Agreement | Vault | Attack Lab |  [AI: Ollama ●]  [Chain: block 128 ●]  [Acting as: ▼ Client]
Routes:
  /                 Start: "Draft a new agreement" or "Open the demo vault"
  /agreement        Agreement studio (6-step wizard)
  /vault/:address   Vault: milestones, ledger, activity
  /attack-lab       Attack Lab
```
- **Role switcher ("Acting as")** is always visible: Client (Incubation Cell), Provider (KrishiLens team), Arbiter (Faculty mentor), Stranger. Keys `1`–`4`. Each shows its name, short address and balance. Switching roles re-renders the allowed actions instantly.
- **Presenter mode** (`P` key or toggle): 115% type scale, hides secondary metadata, enlarges the ledger status and seals. Use it during the demo.

## Role journeys

| Role | Wants to know | Primary actions | What the UI emphasises |
|---|---|---|---|
| Client (funder) | "What am I paying for, and is it what I reviewed?" | Sign, fund, approve (with the file), dispute | Seal match before approving; remaining held funds |
| Provider (team) | "What do I submit, and when do I get paid?" | Sign, mark complete (upload), escalate, withdraw | Next milestone unlocked, review-window countdown, credit to withdraw |
| Arbiter (mentor) | "What is disputed, and what does each side say?" | Resolve (release / refund) with a rationale | Only the disputed milestones; conditions next to the evidence |
| Stranger / judge | "Can I break it?" | Anything, via "Try anyway" and the Attack Lab | Plain-English refusals; the ledger stays reconciled |

---

## Screens

### 1. Agreement studio: Resolve step (the most important wizard screen)
```
┌ Steps: 1 Paste ─ 2 Proposal ─ [3 Resolve] ─ 4 Confirm ─ 5 Deploy ─ 6 Sign & fund ┐
├──────────────────────────────────────────────┬──────────────────────────────────────┤
│ Agreement text (document view)              │ To resolve before money locks   3 / 5 │
│                                              │ ████████████░░░░░░░                  │
│ …the second payment of 2.5 ETH is released  │ ┌ ① Subjective approval  (warning) ┐ │
│ when the prototype works [to the mentor's   │ │ "to the mentor's satisfaction"    │ │
│ satisfaction]①. The third milestone is paid │ │ Who decides "satisfied", and how? │ │
│ from [the remaining funds]② …                │ │ [Edit condition ▾] [note……]  ✓   │ │
│                                              │ └───────────────────────────────────┘ │
│ (highlight colour = state: amber open,      │ ┌ ② Conditional amount (blocking) ┐  │
│  blue edited, green resolved)               │ │ …                                │  │
├──────────────────────────────────────────────┴──────────────────────────────────────┤
│ Proposed by Ollama · llama3.2:3b · 4.2 s     Confirm locked: 2 blocking issues open │
│                                               [Confirm terms]  (disabled + reasons) │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
- Clicking a highlight scrolls to its card and the reverse (two-way link, like Spellbook/Grammarly).
- Every card shows: type (plain words), severity, the exact quote, the question, suggested fixes as one-click chips, an inline editor for the affected field, the action (Edit / Acknowledge / Remove clause) and a required note.
- "Acknowledge" is disabled on blocking cards, with the reason shown: "Blocking issues must be fixed, not just acknowledged."
- The gate bar is sticky and always lists **why** Confirm is locked.

### 2. Agreement studio: Confirm step
- Left: the final terms as a clean document (parties, milestones table, conditions). Edited values carry a small blue "edited" marker with a tooltip showing the original AI value.
- Right: the **agreement seal** (big) + hash + "Only this exact version can be deployed. Change one character and the seal changes." The canonical JSON is collapsible.
- A boundary banner sits between the AI area and this panel: "Above: proposed by AI and edited by people. Below: the confirmed terms that will be signed and deployed."

### 3. Sign & fund (DocuSign pattern)
```
 Agreement seal ◎ 0x9f3a…c41e
 ┌ Client: Incubation Cell ───────┐  ┌ Provider: KrishiLens team ──────┐
 │ ◎ Signed  block 41  0x12…ab  ✓ │  │ Waiting for signature            │
 └────────────────────────────────┘  │ [Sign as provider]               │
                                     └──────────────────────────────────┘
 Fund 5.000 ETH   [Fund escrow]  (locked until both have signed)
```

### 4. Vault (the main demo screen)
```
┌ KrishiLens incubation grant   ◎ agreement seal   [Verify terms ✓ matches]   Active ┐
├──────────────────────────────────────────────────────────┬──────────────────────────┤
│ Milestones                                               │ Ledger         Reconciled │
│ ─────────────────────────────────────────────────────── │ Deposited       5.000 ETH │
│ 1  Problem validation report            1.000 ETH       │ − Released      1.000     │
│    ● Pending ─ ● Completed ─ ● Released                  │ − Refunded      0.000     │
│    Submitted ◎ 0x5c1d…   Approved by client · block 52   │ = In escrow     4.000     │
│ ─────────────────────────────────────────────────────── │ Owed (to withdraw) 1.000  │
│ 2  Working prototype                    2.500 ETH       │ Contract balance 5.000 ✓  │
│    ● Pending ─ ◉ Completed ─ ○ …                         │ ▇▇▇▇▇▇▇▇░░ held/owed/paid │
│    Waiting for: Client  (review window 01:42 left)       │ Surplus (forced) 0.000    │
│    [Approve with file…] [Dispute…]   Try anyway ▾        ├──────────────────────────┤
│ ─────────────────────────────────────────────────────── │ Activity                  │
│ 3  Pilot with 20 farmers                1.500 ETH  Locked│ ✓ Approved M1  block 52   │
│    Unlocks after milestone 2 is settled                  │ ✕ Rejected: approve M1    │
│                                                          │   again (already paid)    │
└──────────────────────────────────────────────────────────┴──────────────────────────┘
```
- **A milestone row** = number, title, amount, a **state track** (dots joined by rules; the disputed path branches below the line), "Waiting for: <role>", the seals that apply, and the actions for the current role.
- Actions not allowed for the current role appear under **"Try anyway"** (a quiet menu). Running one sends the real transaction and shows the refusal.
- **Approve with file**: the client drops the file → its seal is drawn next to the submitted seal → "Seals match" (green) or "These are different files" (red, side by side). Then comes a Rabby-style preview: "This releases 2.500 ETH to KrishiLens team. It can't be undone."
- **The ledger** is written as an equation. The status word "Reconciled" carries a small seal stamp. If it ever fails, the whole panel turns red with the failing check named.

### 5. Attack Lab
```
┌ Attack Lab   Every attack runs as a real transaction on a fresh sandbox vault.  [Run all] ┐
│ 12 of 12 blocked · ledger reconciled after each                         [Reset sandbox]  │
├────┬────────────────────────────┬──────────┬────────────────────────┬──────────┬─────────┤
│    │ Attack                     │ Attacker │ Contract's answer      │ Ledger   │ Verdict │
│ ★  │ Release the same milestone │ Client   │ Already paid out       │ ✓        │ Blocked │
│    │ twice                      │          │ InvalidMilestoneState  │          │         │
│ ★  │ Refund without being the   │ Client   │ Only the arbiter can   │ ✓        │ Blocked │
│    │ arbiter                    │          │ refund  NotArbiter     │          │         │
│ …                                                                                        │
├────────────────────────────────────────────────────────────────────────────────────────── ┤
│ Contrast: the same re-entrancy attack against a naive escrow   Drained 3.000 ETH  Unsafe │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
- ★ marks the four booklet-required attacks (with a legend).
- Each row expands into: what the attacker tried (one sentence), the exact call, expected vs actual, the raw error + args (Tenderly style), "Proven in tests: <test name>".
- "Run all" goes row by row with a visible cursor so the audience can follow; each verdict stamps in.

---

## Components (build once in `web/src/ui/`, reuse everywhere)
| Component | Notes |
|---|---|
| `HashSeal` | props: hash, state (proposed/submitted/onchain/mismatch), size; SVG; draw-in animation once |
| `HashText` | `0x9f3a…c41e` + copy + full-hash tooltip; mono |
| `Amount` | wei bigint → `1.000 ETH`, tabular mono, never floats |
| `RoleChip` | name + role + colour dot + short address |
| `StateTrack` | milestone state dots with the dispute branch |
| `StateBadge` | icon + word for each state |
| `AmbiguityCard` | quote, question, fix chips, editor, action, note |
| `GateBar` | sticky; lists unmet conditions; primary action |
| `ActionSheet` | Rabby-style preview before any money-moving tx |
| `RevertNotice` | plain-English message + error name + args + "nothing changed" |
| `LedgerPanel` | equation, status stamp, held/owed/paid bar |
| `Timeline` | events + rejected attempts |
| `AttackRow` | expandable row with verdict stamp |
| `Toast` | success = green rule, revert = red rule, max 2 visible |

## States every screen must handle
| Situation | What the user sees |
|---|---|
| AI is thinking | Skeleton lines in the checklist pane + "Reading the agreement with Ollama…" + elapsed seconds + a "Use rules instead" button after 8 s |
| AI unreachable | Inline notice: "Ollama isn't responding. Checked with the built-in rules instead." The source badge shows Rules |
| Server offline | Banner: "The AI service isn't running. Start it with npm run server. You can still use the built-in rules." |
| Chain offline | Blocking banner: "Can't reach the local chain at 127.0.0.1:8545. Start it with npm run chain." |
| Tx pending | Button shows a spinner + "Waiting for block…"; the row is locked |
| Tx reverted | `RevertNotice` inline + toast + timeline entry; the row shakes once |
| Empty vault list | "No agreements yet. Draft one from text, or open the demo vault." |
| Nothing to withdraw | Withdraw button disabled: "Nothing owed to you yet" |

## Copy deck: contract errors in plain words
| Error | Title shown | Detail |
|---|---|---|
| `NotClient` | Only the client can do this | You're acting as {role}. Switch to the client to approve or dispute. |
| `NotProvider` | Only the provider can do this | Marking work complete and escalating belong to the provider. |
| `NotArbiter` | Only the arbiter can settle disputes | Refunds happen only through the arbiter's ruling. |
| `NotSigner` | Only the client and provider sign the terms | |
| `WrongAgreementState` | Not available right now | The agreement is {state}. {next step hint} |
| `AgreementHashMismatch` | These aren't the agreed terms | The hash you signed doesn't match the confirmed agreement. |
| `AlreadySigned` | Already signed | |
| `WrongFundingAmount` | Fund the exact total | Expected {expected} ETH, received {sent} ETH. |
| `InvalidMilestoneState` | That step isn't allowed now | Milestone {n} is {state}. {allowed next steps} |
| `MilestoneOutOfOrder` | Finish milestone {expected} first | Milestones are completed in order. |
| `DeliverableHashMismatch` | This isn't the file that was submitted | Submitted {seal A}, yours {seal B}. Approval only applies to the exact file under review. |
| `ReviewWindowOpen` | The client still has time to respond | You can escalate after {time}. |
| `NothingToWithdraw` | Nothing owed to you yet | |
| `TransferFailed` | Payment couldn't be delivered | Nothing changed; your balance is still owed. |
| `DirectPaymentNotAccepted` | Send money through Fund escrow | The vault refuses direct transfers. |
| `InvalidMilestone` | That milestone doesn't exist | |

Every notice ends with **"Nothing changed."** when the transaction reverted. That reassurance is the point.

Button labels keep their names through the flow: "Confirm terms" → toast "Terms confirmed"; "Fund escrow" → "Escrow funded"; "Approve and release" → "Released 2.500 ETH to KrishiLens team".

## Accessibility and projector checks
- Contrast ≥ 4.5:1 for text in both themes; state never shown by colour alone.
- Visible focus ring (2 px `--human`) on everything; full keyboard flow through the wizard.
- Minimum hit target 36 px; minimum text 14 px (16 px in presenter mode).
- Test at 1366×768, 110% zoom, light theme on a bright projector.

## Don'ts
- No neon, glow, gradients, glassmorphism or crypto-casino visuals.
- No all-caps labels, no tracked eyebrows, no "→" glued onto buttons.
- No floating card grids with identical shadows. Use rows on ruled panels.
- No raw error strings without the plain-English line first.
- Never show an AI-proposed value in green.
