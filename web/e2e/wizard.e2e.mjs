// End-to-end walk of the agreement wizard in a real browser (Chrome via playwright-core).
// Needs: `npm run chain`, `npm run server`, `npm run web` running. Rules mode, so it is deterministic.
// Usage: node web/e2e/wizard.e2e.mjs [shots-dir]   (AI_MODE=ollama to walk the live-LLM path: extra cards, "Proposed by Ollama")
import { launch } from "./lib/browser.mjs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { walkVault } from "./vaultWalk.mjs";

const MODE = process.env.AI_MODE ?? "rules";
const BASE = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const SHOTS = process.argv[2] ?? path.resolve("e2e-shots");
mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const log = (m) => console.log(`✓ ${m}`);
const fail = (m) => {
  throw new Error(m);
};

const browser = await launch(); // already onboarded: see lib/browser.mjs
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebSocket|\[vite\]|@vite\/client|Failed to send error to Vite/.test(m.text()) && errors.push(`console: ${m.text()}`));
// Requests the browser could not complete (e.g. net::ERR_NETWORK_ACCESS_DENIED): shown on failure so a refused connection is told apart from an app bug.
const netFailures = [];
page.on("requestfailed", (r) => netFailures.push(`${r.url().replace(BASE, "")} ${r.failure()?.errorText ?? ""}`));
const external = new Set();
page.on("request", (r) => {
  const u = new URL(r.url());
  if (!["127.0.0.1", "localhost"].includes(u.hostname) && !["data:", "blob:", "about:"].includes(u.protocol)) external.add(r.url());
});
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

try {
  await page.goto(`${BASE}/agreement`);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();

  // 1. paste: rules mode, load the KrishiLens sample
  await page.selectOption('select[aria-label="AI mode"]', MODE);
  await page.selectOption('select[aria-label="Load a sample"]', "krishilens.txt");
  const text = await page.inputValue('textarea[aria-label="Agreement text"]');
  if (!text.includes("KrishiLens")) fail("sample did not load");
  await shot("1-paste");
  await page.click('button:has-text("Extract")');
  await page.waitForSelector("text=Proposed checklist", { timeout: MODE === "rules" ? 30000 : 120000 });
  if (MODE === "ollama") {
    const badge = await page.locator("text=/Proposed by/").first().innerText();
    if (!/Proposed by Ollama/.test(badge) || !/d/.test(badge)) fail(`expected an Ollama badge with latency, saw: ${badge}`);
    log(`badge: ${badge}`);
  }
  log(`extracted in ${MODE} mode`);
  await shot("2-proposal");
  const flagged = await page.locator("mark.amb").count();
  if (flagged < 4) fail(`expected at least 4 highlighted terms, saw ${flagged}`);
  log(`${flagged} terms highlighted in the agreement text`);

  // 2. resolve: Confirm must be locked until every issue is resolved
  await page.click('button:has-text("Resolve the issues")');
  await page.waitForSelector("#cards .amb-card");
  const cards = await page.locator("#cards .amb-card").count();
  if (MODE === "rules" ? cards !== 5 : cards < 5) fail(`unexpected ambiguity card count ${cards}`);
  const gateBtn = page.locator('.gate button:has-text("Review confirmed terms")');
  if (!(await gateBtn.isDisabled())) fail("gate button must be locked while issues are open");
  const reason = await page.locator(".gate ul").innerText();
  if (!/blocking/.test(reason)) fail(`gate should list blocking issues, saw: ${reason}`);
  await shot("3-resolve-open");
  log("Confirm is locked with a visible reason while issues are open");

  // an acknowledged blocking issue must be refused in the UI
  const card = (id) => page.locator(`[data-ambiguity="${id}"]`);
  await card("CONDITIONAL_AMOUNT:2:0").locator("select").selectOption("acknowledged");
  await card("CONDITIONAL_AMOUNT:2:0").locator('input[aria-label="Note (required)"]').fill("trying to just acknowledge");
  if (!(await card("CONDITIONAL_AMOUNT:2:0").locator('button:has-text("Resolve")').isDisabled())) fail("acknowledging a blocking issue must be disabled");
  await card("CONDITIONAL_AMOUNT:2:0").locator("select").selectOption("edited");
  log("acknowledging a blocking issue is refused");

  const chip = async (id, label) => {
    await card(id).locator(`button.fix:has-text("${label}")`).first().click();
  };
  await chip("CONDITIONAL_AMOUNT:2:0", "ETH (total");
  await chip("CONDITIONAL_AMOUNT:1:0", "Remove the conditional clause");
  await chip("SUBJECTIVE_APPROVAL:1:0", "Replace with: A live demo");
  await chip("MISSING_DEADLINE:2:0", "Acknowledge");
  if (MODE === "ollama") {
    // cards only a live LLM produces: the blocking one is removed, the warning is acknowledged
    await chip("UNDEFINED_TRANSITION:2:0", "Remove this clause");
    await chip("VAGUE_CONDITION:1:0", "Acknowledge");
  }
  await card("AMOUNT_MISMATCH:agreement:0").waitFor();
  await chip("AMOUNT_MISMATCH:agreement:0", "Set the total to");
  if (await gateBtn.isDisabled()) fail("gate should open once everything is resolved: " + (await page.locator(".gate ul").innerText()));
  await shot("4-resolve-done");
  log("all five issues resolved with one-click fixes; the gate opened");

  // 3. confirm
  await gateBtn.click();
  await page.waitForSelector("text=Confirmed terms");
  await page.click('button:has-text("Confirm terms")');
  await page.waitForSelector("text=Agreement seal");
  await page.waitForSelector("text=Canonical JSON that was hashed");
  await page.waitForSelector("text=Only this exact version can be signed and deployed");
  await shot("5-confirm");
  const hash = await page.locator(".sealcard .hash").first().getAttribute("title");
  if (!/^0x[0-9a-f]{64}$/.test(hash)) fail(`bad agreement hash ${hash}`);
  log(`confirmed: agreement hash ${hash}`);

  // 4. deploy, sign, fund
  await page.click('button:has-text("Deploy and continue")');
  await page.click('button:has-text("Deploy escrow contract")');
  await page.waitForSelector("text=Sign and fund", { timeout: 30000 });
  const fundBtn = page.locator('button:has-text("Fund escrow")');
  if (!(await fundBtn.isDisabled())) fail("funding must be locked until both parties sign");
  await shot("6-sign");
  await page.click('button:has-text("Sign as client")');
  await page.waitForSelector('[data-signature="client"] .stamp-ok');
  if (!(await fundBtn.isDisabled())) fail("funding must stay locked with one signature");
  await page.click('button:has-text("Sign as provider")');
  await page.waitForSelector('[data-signature="provider"] .stamp-ok');
  await shot("7-signed");
  await fundBtn.click();
  await page.waitForURL(/\/vault\/0x[0-9a-fA-F]{40}/, { timeout: 30000 });
  await page.waitForSelector(".ledger .stamp:has-text(\"Reconciled\")");
  if (!/5.000/.test(await page.locator(".ledger").innerText())) fail("the ledger should show the 5.000 ETH deposit");
  await shot("8-vault");
  log("deployed, signed by both, funded, and the vault reconciles");

  // 4b. the same vault-screen walk (demo steps 6-9 + Verify) on this freshly created vault. WALK_VAULT=0 skips it.
  if (process.env.WALK_VAULT !== "0") {
    await walkVault(page, { seeded: false, shot: (name) => page.screenshot({ path: path.join(SHOTS, `fresh-${name}.png`) }), log });
    log("the full vault walk passed on the wizard-created vault");
  }

  // 5. a refresh mid-flow keeps the place
  await page.goto(`${BASE}/agreement`);
  await page.waitForSelector("text=Sign and fund");
  log("state survived a page reload");

  if (external.size) fail(`the app made requests to the internet (it must work offline):\n${[...external].join("\n")}`);
  log("every request stayed on 127.0.0.1 (fonts and scripts are bundled; works offline)");
  if (errors.length) fail(`browser errors:\n${errors.join("\n")}`);
  console.log("E2E PASSED");
} catch (e) {
  await shot("failure").catch(() => {});
  console.error("E2E FAILED:", e.message);
  if (errors.length) console.error("browser errors seen before the failure:\n" + errors.join("\n"));
  if (netFailures.length) console.error("FAILED NETWORK REQUESTS (refused by the environment, not an app error):\n" + netFailures.join("\n"));
  console.error("page url at failure:", page.url(), "| root children:", await page.evaluate(() => document.getElementById("root")?.children.length).catch(() => "n/a"));
  process.exitCode = 1;
} finally {
  await browser.close();
}
