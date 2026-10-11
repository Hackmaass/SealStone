# P00 — Bootstrap the monorepo
**Depends on:** nothing · **Time box:** 30 min

## Paste this
````text
Read CLAUDE.md and docs/02-PLAN.md. Then set up the monorepo skeleton. Don't write any product logic yet.

Context: Windows host. Use only cross-platform npm scripts (cross-env, concurrently, rimraf). Use non-interactive commands only.

1. Root:
   - package.json with npm workspaces ["shared", "contracts", "server", "web"] and the scripts listed in CLAUDE.md. For scripts whose target doesn't exist yet, point them at a tiny placeholder that prints "not implemented yet (Pxx)".
   - devDependencies: concurrently, cross-env, rimraf.
   - .gitignore (node_modules, artifacts, cache, typechain-types, coverage, dist, .env, server/data/agreements/*.json but keep a .gitkeep).
   - .env.example with AI_MODE=auto, OLLAMA_URL=http://127.0.0.1:11434, OLLAMA_MODEL=llama3.2:3b, GEMINI_API_KEY=, GEMINI_MODEL=, SERVER_PORT=8787, RPC_URL=http://127.0.0.1:8545
2. shared/ (package name @mv/shared, "type": "module", main and types pointing at src/index.ts, TS only, no build step): empty src/index.ts, vitest for tests.
3. contracts/: Hardhat 2 TypeScript project created by hand (not the interactive init):
   - hardhat ^2.22, @nomicfoundation/hardhat-toolbox ^5, @openzeppelin/contracts ^5, typescript, ts-node, @types/node, @types/mocha, @types/chai
   - hardhat.config.ts: solidity 0.8.24, optimizer on (200 runs), evmVersion "cancun"; networks.localhost = http://127.0.0.1:8545; mocha timeout 120000
   - folders contracts/, contracts/attack/, test/, scripts/
   - a placeholder contract Placeholder.sol so `npx hardhat compile` works (we delete it in P01)
4. server/: Express + TypeScript run with tsx; dependencies express, cors, zod, ethers@6, dotenv; dev: tsx, typescript, vitest, @types/express, @types/cors. src/index.ts with GET /api/health returning { ok: true }. Port from SERVER_PORT, default 8787.
5. web/: create with `npm create vite@latest web -- --template react-ts` (non-interactive), add ethers@6 and @mv/shared as a workspace dependency. The dev server is on port 5173. Replace the Vite demo page with a one-line "MilestoneVault" placeholder.
6. samples/: create samples/agreements/ and samples/README.md explaining that the teammate adds fictional agreement .txt files plus samples/expected.json (format defined later in P06).
7. Run `npm install` at the root. Then verify each of these and paste the outputs into docs/PROGRESS.md:
   - node -v (must be >= 20)
   - npx hardhat compile (in contracts)
   - npm run server → curl http://127.0.0.1:8787/api/health
   - npm run web starts (then stop it)
   - `ollama --version` and `ollama list` (just record what's there; don't fail if missing)
8. git init, commit "P00: monorepo skeleton".

Update docs/PROGRESS.md: mark P00 ✅ with the verification outputs, and log any decisions.
````

## Acceptance checks
- [ ] `npm install` at the root completes without errors
- [ ] `npx hardhat compile` works in `contracts/`
- [ ] `http://127.0.0.1:8787/api/health` returns `{ "ok": true }`
- [ ] `http://localhost:5173` shows the placeholder
- [ ] PROGRESS.md shows your Node version and Ollama models

**If Ollama has no model:** run `ollama pull llama3.2:3b` now (about 2 GB). Do it at home or on good Wi-Fi before the event.
