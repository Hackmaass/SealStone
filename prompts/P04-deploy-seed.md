# P04 — Shared hashing, deploy and seed scripts, ABI export, demo reset
**Depends on:** P03 · **Time box:** 30 min

## Paste this
````text
Read CLAUDE.md (shared/ rules) and docs/05-AI-SPEC.md, the ConfirmedChecklist section.

1. shared/src/:
   - canonical.ts: canonicalJSON(value) sorts object keys recursively, keeps array order, no whitespace; rejects undefined, functions, NaN and Infinity, and requires bigint values to be converted to decimal strings before calling.
   - hash.ts: agreementHash(confirmed) = keccak256(toUtf8Bytes(canonicalJSON(confirmed))); textHash(str) = keccak256(utf8); fileSha256(bytes: Uint8Array) using WebCrypto (works in Node 20 and the browser) returning 0x-hex.
   - schema/confirmed.ts: the zod schema + type for ConfirmedChecklist exactly as in docs/05.
   - index.ts exports all of these.
   - test/vector.json: one fixed ConfirmedChecklist and its expected canonical string and hash. Add a vitest test that checks them (generate the expected values once, then freeze them).

2. samples/krishilens.confirmed.json: the fictional, already-resolved KrishiLens checklist from docs/02 (3 milestones: 1.0, 2.5, 1.5 ETH in wei strings; parties' addresses = Hardhat accounts #0, #1, #2; reviewWindowSeconds 120; resolutions describing how each original ambiguity was fixed).

3. contracts/scripts/deploy-demo.ts (run with --network localhost):
   - import from ../../shared/src (relative path)
   - read samples/krishilens.confirmed.json, validate with zod, compute agreementHash
   - deploy MilestoneVault from account #0, both parties sign, fund, then provider marks M0 complete with sha256 of "m1-report.pdf (demo)". This is the "pre-seeded" vault, a backup if the live wizard fails.
   - write web/src/generated/deployment.json: { chainId, rpcUrl, accounts: { client: 0, provider: 1, arbiter: 2, stranger: 3, sandboxClient: 4, sandboxProvider: 5, sandboxArbiter: 6 } with addresses, preseededVault: { address, agreementHash }, generatedAt }
   - copy the confirmed JSON to server/data/agreements/<hash>.json
4. contracts/scripts/export-abi.ts: write web/src/generated/contracts.ts exporting { abi, bytecode } for MilestoneVault, ReentrantProvider, NaiveEscrow, NaiveDrainer, ForceSender (read from artifacts). Run it automatically after compile in the deploy:demo script.
5. contracts/scripts/reset.ts: send the JSON-RPC "hardhat_reset" to RPC_URL, then run deploy-demo. Wire root scripts: deploy:demo, demo:reset.
6. Verify: start `npm run chain` in one terminal, run `npm run deploy:demo`, then run `npm run demo:reset` twice. Both must succeed and print the vault address and reconcile().ok.

Update PROGRESS.md. Commit "P04: shared hashing, deploy/seed, ABI export, reset".
````

## Acceptance checks
- [ ] `vector.json` hash test passes in `shared/`
- [ ] `deploy:demo` prints an address and `ok: true`
- [ ] `demo:reset` works twice in a row without restarting the node
- [ ] `web/src/generated/contracts.ts` exists
