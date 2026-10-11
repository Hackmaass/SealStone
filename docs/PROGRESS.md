# PROGRESS (Claude Code updates this at the end of every prompt)

## Status
| Prompt | Status | Notes |
|---|---|---|
| P00 Bootstrap | ✅ | see P00 verification below |
| P01 Contract core | ⬜ | |
| P02 Core tests | ⬜ | |
| P03 Attacks + invariant | ⬜ | |
| P04 Deploy + seed | ⬜ | |
| P05 AI service | ⬜ | |
| P06 AI eval | ⬜ | |
| P07 Web: agreement wizard | ⬜ | |
| P08 Web: milestones + ledger | ⬜ | |
| P09 Web: Attack Lab | ⬜ | |
| P10 Stretch | ⬜ | |
| P11 Integration + README | ⬜ | |
| P12 Judge-proof audit | ⬜ | |

Legend: ⬜ not started · 🟨 in progress · ✅ done (acceptance checks pass) · ✂️ cut

## Latest numbers
- Contract tests: — passing / — total
- Coverage (MilestoneVault.sol): lines —% · branches —%
- AI eval: see docs/EVAL-RESULTS.md

## Decisions log
- 2026-10-11 P00: removed `"type": "module"` from `shared/package.json` (the P00 prompt asked for it). Hardhat's ts-node (CJS) failed to load `../../shared/src/index.ts` with `ERR_REQUIRE_ESM` ("is a .ts file whose nearest parent package.json contains type: module"). Without the flag, Hardhat scripts (ts-node), server (tsx) and web (Vite) all import shared fine. Use extensionless relative imports inside `shared/`.
- 2026-10-11 P00: `server/` is `"type": "module"` (tsx); `contracts/` stays CommonJS (Hardhat 2 requirement). Workspace dep is `"@mv/shared": "*"` (npm rejects `workspace:*`).
- 2026-10-11 P00: placeholder npm scripts call `node scripts/todo.mjs Pxx` (avoids cmd.exe quoting problems).
- 2026-10-11 P00: Ollama default model `llama3.2:3b` (per `.env.example`) is NOT installed; `qwen2.5:7b-instruct` is. Kept `.env.example` as specified. Either `ollama pull llama3.2:3b` or set `OLLAMA_MODEL=qwen2.5:7b-instruct` in `.env`. User decides (pull is ~2 GB).
- 2026-10-11 P00: Vite scaffold resolved to Vite 8 / React 19 / TypeScript 6 (newest create-vite). Dev server pinned to 127.0.0.1:5173 with `strictPort`.

## P00 verification (2026-10-11)
- `node -v` → v24.19.0 (npm 11.17.0, git 2.55.0). Hardhat resolved 2.29.1, toolbox 5.0.0; `@openzeppelin/contracts/utils/ReentrancyGuard.sol` present.
- `npx hardhat compile` (contracts/) → "Compiled 1 Solidity file successfully (evm target: cancun)", no warnings.
- shared→contracts import probe (`hardhat run`), shared→server probe (`tsx`): both print `mv-shared-ok` (after the decision above).
- Server: `GET http://127.0.0.1:8787/api/health` → `{"ok":true}`. Web: Vite 8 serves the placeholder at http://127.0.0.1:5173/. Both stopped afterwards.
- `ollama --version` client 0.34.0. `ollama list`: `qwen2.5:7b-instruct` (4.7 GB), `hf.co/HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive:Q6_K_P` (7.2 GB), `hf.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive:Q4_K_M` (6.5 GB). No `llama3.2:3b`.
- npm install warned: 60 audit vulnerabilities in transitive dev deps (hardhat toolchain), and "allow-scripts" notes for keccak/secp256k1/esbuild install scripts (not run; everything above works without them).

## Open questions
-

## Known issues
-
