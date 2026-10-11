# 03 — What we borrowed, and from whom

The status column is honest on purpose. In the pitch, only call something a "winner" if it says ✅.

| Reference | Status | What they did | What we borrow | How we adapt it |
|---|---|---|---|---|
| Agent Escrow (Build Week Hackathon 2026, APU student team) | ✅ 1st place | Every stage enforced on-chain; reentrancy guard + CEI; auto-pay after the review period | Security hardening; "every transition on-chain" | Their timeout auto-pays. Ours **escalates to the arbiter**, because the booklet rejects undefined transitions |
| Gig-Escrow (ETHIndia, Devfolio) | ⚠️ Showcase | Hit a real vulnerability, fixed it with CEI; time-based auto-refunds | The "found an attack, fixed it" story | The Attack Lab shows it live, with a naive-escrow contrast |
| Trustless Work (Stellar Community Fund) | ✅ $70K grant | Separate roles (marker, approver, releaser, dispute resolver); approver alone approves or disputes | The role model | Collapsed to client / provider / arbiter, per the booklet |
| Boundless (Stellar Community Fund) | ✅ $110K grant | Milestone escrow for grants and hackathons; submit proof → review → release | The "submit proof" step; the grant use case | Proof = SHA-256 deliverable hash; KrishiLens incubation grant |
| Fhenix Escrow (HackQuest) | ⚠️ Showcase | Both parties sign terms before funding | Dual signing before funding | Both sign the **agreement hash** |
| ArbiSecure (Arbitrum buildathons) | ⚠️ Showcase | Programmable per-milestone conditions; staked arbiters | Per-milestone condition checklist | Conditions come from the human-confirmed checklist; no staking |
| TaskLoop (ETHGlobal) | ⚠️ Showcase | AI review → verdict, confidence, reasons, action, all logged | Structured AI output schema | We **reject** AI-triggered release; our AI is advisory only |
| EscrowChain | ⚠️ Showcase | Arbiter nominated at creation | Arbiter fixed at deploy | Immutable `arbiter` |
| EscrowDesk (ETHGlobal New Delhi) | ⚠️ Showcase | Checked GitHub progress against requirements | Git commit hash as a deliverable | Optional in M2 of the demo |
| Conditional Escrow with Chainlink CRE | ⚠️ Placement unknown | Release only after verified, signed completion | "Verified before release" | Verified by hash match, locally; no oracle |
| Freelance Forge (ETHGlobal) | ⚠️ Showcase | Factory pattern for many agreements | `VaultFactory` | Stretch only |
| Kleros / ERC-792 | 📚 Standard | Arbitrator ruling interface | `resolve(i, ruling, rationale)` shape | Rulings limited to Release / Refund |
| Chainlink Convergence 2026 winners (agent execution firewall, CRE Risk Router) | ✅ Winners | Check actions *before* they execute | Framing: "a gate before money moves" | Ambiguity gate + Attack Lab |
| ActionGate (booklet C-01) | Problem statement | Approval bound to the exact action's digest | **Headline idea** | Approval bound to the exact deliverable hash |

## What's original here (our innovation claim)
None of the projects above combine these four:
1. **Ambiguity gate:** deployment is blocked until every flagged term has a human resolution, and the confirmed terms are hashed on-chain and co-signed.
2. **Hash-bound approval:** the client approves a specific deliverable hash, so a swapped file reverts.
3. **Clickable Attack Lab** with a naive-escrow contrast (the same attack drains the naive contract and fails on ours).
4. **Live reconciliation**, including detection of force-sent ETH as surplus.

## Deliberately not borrowed (and why, if a judge asks)
- **Confidential amounts (Green Road, Fhenix FHE):** too heavy for 12 hours; transparency is a feature for grants.
- **Staked arbiter marketplace (ArbiSecure):** needs token economics; out of scope.
- **Reputation / soulbound tokens (ETHJobs, Gig-Escrow):** not needed by the booklet.
- **ERC-4626 vault (Get Paid):** yield on escrowed funds adds risk without helping the problem.
- **AI-triggered release (TaskLoop):** forbidden by the booklet, and unsafe.

## Sources
- Agent Escrow — https://www.apu.edu.my/node/3306
- Gig-Escrow — https://devfolio.co/projects/gigescrow-1bd1
- Trustless Work — https://communityfund.stellar.org/submissions/rectq5U666PxPloNn , https://docs.trustlesswork.com/trustless-work/technology-overview/escrow-lifecycle/approval-phase
- Boundless — https://communityfund.stellar.org/dashboard/projects/rec4wnGFWKWFzwxQK
- Fhenix Escrow — https://arbitrum.hackquest.io/projects/Fhenix-Escrow
- ArbiSecure — https://arbitrum.hackquest.io/projects/ArbiSecure
- TaskLoop — https://ethglobal.com/showcase/taskloop-oim40
- EscrowChain — https://showcase.learn2earn.ng/projects/escrowchain
- EscrowDesk — https://ethglobal.com/showcase/escrowdesk-i1uuv
- Conditional Escrow (Chainlink) — https://chain.link/hack-26/projects/conditional-escrow-with-chainlink-cre
- Freelance Forge — https://ethglobal.com/showcase/freelance-forge-pr83s
- ERC-792 — https://erc-792.readthedocs.io/en/latest/implementing-an-arbitrable.html
- Convergence winners — https://chain.link/blog/convergence-hackathon-winners , https://chain.link/hackathon/winners
- ETHJobs.cc (PayPal PYUSD prize, ETHGlobal NY 2025) — https://ethglobal.com/showcase/ethjobs-cc-gx5fm
- Green Road (2nd in track, Stellar São Paulo) — https://developers.stellar.org/meetings/2026/08/13
