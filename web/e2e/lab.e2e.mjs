// Attack Lab end to end: "Run all" three times in a row with no reload, and the pre-seeded demo vault untouched.
// Needs: chain, server and web running, and a fresh `npm run demo:reset`. Usage: node web/e2e/lab.e2e.mjs [shots-dir]
import { chromium } from "playwright-core";
import { Interface, JsonRpcProvider } from "ethers";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const SHOTS = process.argv[2] ?? path.resolve("e2e-shots");
mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const deployment = JSON.parse(readFileSync(new URL("../src/generated/deployment.json", import.meta.url), "utf8"));
const VAULT = deployment.preseededVault.address;

const rpc = new JsonRpcProvider(deployment.rpcUrl, deployment.chainId, { staticNetwork: true });
const iface = new Interface(["function getMilestone(uint256) view returns (tuple(uint256 amount,uint8 state,bytes32 deliverableHash,bytes32 evidenceHash,bytes32 rationaleHash,uint64 completedAt))"]);
// Loopback connections are occasionally refused by this environment (connect EACCES); a read is safe to repeat.
async function retry(fn, tries = 30) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries || !/EACCES|ECONNREFUSED|ECONNRESET|network/i.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
const snapshotDemoVault = () => retry(snapshotOnce);
async function snapshotOnce() {
  const logs = await rpc.getLogs({ address: VAULT, fromBlock: 0, toBlock: "latest" });
  const m0 = iface.decodeFunctionResult("getMilestone", await rpc.call({ to: VAULT, data: iface.encodeFunctionData("getMilestone", [0]) }))[0];
  return JSON.stringify({ events: logs.map((l) => `${l.blockNumber}:${l.index}:${l.transactionHash}`), m0State: Number(m0.state), balance: (await rpc.getBalance(VAULT)).toString(), code: (await rpc.getCode(VAULT)).length });
}

const BOOKLET = ["rejects a second release attempt", "rejects an unauthorized refund", "rejects an out-of-order transition", "blocks a re-entrancy attack"];

const log = (m) => console.log(`✓ ${m}`);
const fail = (m) => {
  throw new Error(m);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
// Vite's dev-only hot-reload socket is also refused now and then by this environment; that is not the app.
page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebSocket|\[vite\]|@vite\/client|Failed to send error to Vite/.test(m.text()) && errors.push(`console: ${m.text()}`));
const external = new Set();
page.on("request", (r) => {
  const u = new URL(r.url());
  if (!["127.0.0.1", "localhost"].includes(u.hostname) && !["data:", "blob:", "about:"].includes(u.protocol)) external.add(r.url());
});

try {
  const before = await snapshotDemoVault();
  if (JSON.parse(before).m0State !== 1) fail("run `npm run demo:reset` first: the demo vault's milestone 1 should be Completed");

  // This sandbox sometimes refuses a headless-browser connection (net::ERR_NETWORK_ACCESS_DENIED) before the app even loads.
  // That is not the app: retry the page load a few times, and say so if it happened.
  let loads = 0;
  for (; loads < 8; loads++) {
    await page.goto(`${BASE}/attack-lab`).catch(() => {});
    if (await page.waitForSelector('[data-testid="run-all"]', { timeout: 4000 }).then(() => true).catch(() => false)) break;
  }
  if (loads >= 8) fail("the Attack Lab page never rendered, even after 8 loads");
  if (loads > 0) console.log(`(note: the page needed ${loads + 1} loads: the environment refused ${loads} connection(s))`);

  for (let n = 1; n <= 3; n++) {
    await page.click('[data-testid="run-all"]');
    await page.waitForSelector('[data-testid="run-all"]:has-text("Running")');
    if (n === 1) await page.screenshot({ path: path.join(SHOTS, "lab-running.png") });
    // wait for the button to come back (no reload between runs)
    await page.waitForFunction(() => document.querySelector('[data-testid="run-all"]')?.textContent?.trim() === "Run all attacks", null, { timeout: 180000 });

    const rows = await page.locator("tr[data-attack]").evaluateAll((trs) => trs.map((tr) => ({ id: tr.dataset.attack, status: tr.dataset.status, verdict: tr.querySelector('[data-testid="verdict"]')?.textContent?.trim(), ledger: tr.querySelector('[data-testid="ledger"]')?.textContent?.trim() })));
    if (rows.length !== 13) fail(`expected 12 attacks + the contrast row, saw ${rows.length}`);
    const attacks = rows.filter((r) => r.id !== "naive-contrast");
    const bad = attacks.filter((r) => r.status !== "pass");
    if (bad.length) {
      await page.screenshot({ path: path.join(SHOTS, `lab-fail-run${n}.png`), fullPage: true });
      fail(`run ${n}: attacks that did not behave as expected: ${JSON.stringify(bad)}`);
    }
    for (const r of attacks) if (!["Blocked", "Absorbed"].includes(r.verdict)) fail(`run ${n}: ${r.id} verdict "${r.verdict}"`);
    const ledgers = attacks.filter((r) => /reconciled/.test(r.ledger ?? "") && !/not|✕/.test(r.ledger ?? ""));
    if (ledgers.length !== 12) fail(`run ${n}: expected 12 reconciled ledgers, saw ${ledgers.length}: ${JSON.stringify(attacks.map((r) => r.ledger))}`);
    const contrast = rows.find((r) => r.id === "naive-contrast");
    if (contrast.verdict !== "Unsafe" || !/short 3\.000/.test(contrast.ledger)) fail(`run ${n}: the contrast row should be Unsafe and short 3.000, saw ${JSON.stringify(contrast)}`);
    const contrastAnswer = await page.locator('tr[data-attack="naive-contrast"] [data-testid="answer"]').innerText();
    if (!/Drained 3\.000 ETH/.test(contrastAnswer)) fail(`run ${n}: contrast answer should say it drained 3.000 ETH: ${contrastAnswer}`);
    const score = await page.locator('[data-testid="score-blocked"]').innerText();
    if (score !== "12") fail(`run ${n}: score should read 12, saw ${score}`);
    log(`run ${n} of 3: 12 of 12 blocked, 12 ledgers reconciled, contrast drained 3.000 ETH (no page reload)`);
  }

  // the booklet rows: a star, a badge, and the exact test names
  const stars = await page.locator("table.lab .star").count();
  if (stars < 4) fail(`expected 4 starred booklet rows, saw ${stars}`);
  for (const details of await page.locator('button:has-text("Details")').all()) await details.click();
  const proofs = await page.locator('[data-testid="proofs"] li').allInnerTexts();
  for (const name of BOOKLET) if (!proofs.includes(name)) fail(`missing the booklet test name "${name}" in the Proven in tests lists`);
  log(`4 booklet rows carry a star, a badge and their exact test names (${proofs.length} test links in total)`);

  // the re-entrancy row proves the guard, not a gas accident
  const reentry = await page.locator('tr[data-attack="reentrancy"] + tr.lab-detail').innerText();
  if (!/ReentrancyGuardReentrantCall/.test(reentry) || !/exactly what it was owed/.test(reentry)) fail("the re-entrancy row should show the guard's own refusal and the exact payout");
  log("the re-entrancy row shows the guard's own refusal (ReentrancyGuardReentrantCall) and an exact payout");
  await page.screenshot({ path: path.join(SHOTS, "lab-done.png"), fullPage: true });

  // the demo vault was never touched by 39 sandbox runs
  const after = await snapshotDemoVault();
  if (after !== before) fail(`the pre-seeded demo vault changed while the lab ran:\nbefore ${before}\nafter  ${after}`);
  log("the pre-seeded demo vault is exactly as it was: same events, milestone 1 still Completed, same balance");

  if (external.size) fail(`requests left the machine:\n${[...external].join("\n")}`);
  if (errors.length) fail(`browser errors:\n${errors.join("\n")}`);
  console.log("LAB E2E PASSED");
} catch (e) {
  await page.screenshot({ path: path.join(SHOTS, "lab-failure.png"), fullPage: true }).catch(() => {});
  console.error("LAB E2E FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
