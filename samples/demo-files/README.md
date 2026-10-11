# Demo deliverables (fictional)

Two tiny stand-in files for the swapped-deliverable step of the demo. They are not real PDFs: Sealstone only hashes bytes.

| File | Bytes | SHA-256 |
|---|---|---|
| `m1-report.pdf` | the 20 ASCII characters `m1-report.pdf (demo)`, no newline | the hash the pre-seeded demo vault stored for milestone 1 |
| `m1-report-v2.pdf` | a look-alike with different contents | a different hash, so approving it is refused with `DeliverableHashMismatch` |

The app also ships the same two files (`web/public/demo/`) so the approve and submit sheets offer them in one click. Keep the copies identical: `web/src/lib/files.test.ts` checks it, and checks that `m1-report.pdf` still hashes to what `deploy-demo.ts` seeds.
