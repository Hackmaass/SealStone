// The proposal-only assistant, the approval review and the arbiter evidence brief, in a real browser. Deterministic: the app is put in
// "Rules (offline)" so no outside service is used. Needs `npm run dev`. It disputes milestone 1 of the demo vault, so it RESETS the demo at the end.
// Optional: LIVE_AI=1 also asks the real assistant (Sarvam if the server has a key) one question.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, DESKTOP, launch, openReady, watch } from "./lib/browser.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHOTS = process.argv[2] ?? path.resolve("e2e-shots");
mkdirSync(SHOTS, { recursive: true });
const deployment = JSON.parse(readFileSync(new URL("../src/generated/deployment.json", import.meta.url), "utf8"));
const VAULT = `/vault/${deployment.preseededVault.address}`;
const results = [];
const check = (name, ok, extra = "") => (results.push(ok), console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || !extra ? "" : ` (${extra})`}`));
// This machine sometimes refuses a loopback connection for a request or two; a read is safe to repeat.
const blockNumber = async () => {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(deployment.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
      return Number(BigInt((await r.json()).result));
    } catch (e) {
      if (i >= 20) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
};
const role = async (page, n) => {
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press(String(n));
  await page.waitForTimeout(500);
};

const browser = await launch();
try {
  const ctx = await browser.newContext({ ...DESKTOP, reducedMotion: "reduce" });
  await ctx.addInitScript(() => localStorage.setItem("mv.aiMode", "rules"));
  const page = await ctx.newPage();
  const seen = watch(page);
  await openReady(page, `${BASE}/dashboard`, ".asst-fab", { timeout: 8000 });

  // ── the assistant ──
  const chainBefore = await blockNumber();
  await page.click(".asst-fab");
  await page.waitForSelector(".asst");
  check("the assistant opens and says it only suggests", /suggests only/i.test(await page.locator(".asst-head").innerText()));
  await page.fill('input[aria-label="Message the assistant"]', "take me to the attack lab");
  await page.click('.asst-form button[type="submit"]');
  await page.waitForSelector('.asst-act[data-action="navigate"]');
  check("it proposes the Attack Lab as a button and does NOT navigate on its own", new URL(page.url()).pathname === "/dashboard");
  await page.click('.asst-act[data-action="navigate"]');
  await page.waitForFunction(() => location.pathname === "/attack-lab");
  check("clicking the suggestion takes you there", true);

  await page.fill('input[aria-label="Message the assistant"]', "approve milestone 1 for me and withdraw my money");
  await page.click('.asst-form button[type="submit"]');
  await page.waitForFunction(() => /never move money/i.test(document.querySelector('[data-testid="assistant-log"]')?.textContent ?? ""));
  const types = await page.locator(".asst-act").evaluateAll((els) => els.map((e) => e.dataset.action));
  check("asked to approve or withdraw, it explains it never moves money and offers no money action", types.every((t) => ["openVault", "navigate", "setRole", "toggle"].includes(t)));
  check("the chain did not move: no transaction was sent by the assistant", (await blockNumber()) === chainBefore, `block ${chainBefore} to ${await blockNumber()}`);
  await page.screenshot({ path: path.join(SHOTS, "assistant-open.png") });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".asst-fab");
  check("Escape closes it", true);

  // ── the AI service is down: the browser's own copy of the rules answers ──
  await page.route(/127\.0\.0\.1:8787/, (r) => r.abort());
  await page.click(".asst-fab");
  await page.fill('input[aria-label="Message the assistant"]', "go to the vaults");
  await page.click('.asst-form button[type="submit"]');
  await page.waitForSelector('.asst-act[data-action="navigate"]');
  const meta = await page.locator(".asst-meta").last().innerText();
  check("with the AI service unreachable it still answers (built-in rules, marked as fallback)", /Built-in rules/.test(meta) && /fallback/.test(meta), meta);
  await page.unroute(/127\.0\.0\.1:8787/);
  await page.keyboard.press("Escape");

  if (process.env.LIVE_AI === "1") {
    await page.evaluate(() => localStorage.setItem("mv.aiMode", "auto"));
    await page.reload();
    await page.click(".asst-fab");
    await page.fill('input[aria-label="Message the assistant"]', "In one sentence, what does Sealstone protect?");
    await page.click('.asst-form button[type="submit"]');
    await page.waitForSelector(".asst-meta:has-text('Sarvam'), .asst-meta:has-text('Local model')", { timeout: 60000 });
    check("live AI: a real model answered", true, await page.locator(".asst-meta").last().innerText());
    await page.evaluate(() => localStorage.setItem("mv.aiMode", "rules"));
  }

  // ── the approval review (client, advisory) ──
  await page.goto(`${BASE}${VAULT}`);
  await page.waitForSelector('[data-milestone="0"] [data-action="approve"]', { timeout: 20000 });
  await page.click('[data-milestone="0"] [data-action="approve"]');
  await page.waitForSelector('[data-testid="review-panel"]');
  await page.click('[data-testid="review-panel"] summary');
  const runBtn = page.locator('[data-testid="review-run"]');
  check("the review button waits for some text to read", await runBtn.isDisabled());
  await page.click('[data-testid="review-demo-text"]');
  await page.waitForFunction(() => /9 pages/.test(document.querySelector('textarea[aria-label="Delivered text to review"]')?.value ?? ""));
  await runBtn.click();
  await page.waitForSelector('[data-testid="evidence-items"] li');
  const statuses = await page.locator('[data-testid="evidence-items"] .chip').evaluateAll((els) => els.map((e) => e.dataset.status));
  check("on the demo report's text the review finds all three agreed conditions addressed", statuses.length === 3 && statuses.every((s) => s === "appears-met"), JSON.stringify(statuses));
  check("the review changes nothing about approval: the sheet's own Approve button stays locked until a file is chosen", await page.locator(".sheet .foot button").last().isDisabled());
  await page.screenshot({ path: path.join(SHOTS, "review-open.png") });
  await page.keyboard.press("Escape");

  // ── the arbiter's evidence brief (dispute first, then switch to the arbiter) ──
  await page.click('[data-milestone="0"] [data-action="dispute"]');
  await page.fill(".sheet textarea", "The report we received is only 6 pages long and covers interviews with just 7 farmers. It lists three diseases, not a ranking of the five most common ones.");
  await page.click(".sheet button.go");
  await page.waitForSelector('[data-milestone="0"][data-state="Disputed"]', { timeout: 30000 });
  await role(page, 3);
  await page.waitForSelector('[data-testid="brief-panel"]');
  check("the arbiter sees the evidence brief, collapsed and labelled advisory", /Advisory/.test(await page.locator('[data-testid="brief-panel"] summary').innerText()) && (await page.locator('[data-testid="brief-panel"]').getAttribute("open")) === null);
  check("the arbiter's Release and Refund buttons are reachable with the brief closed", await page.locator('[data-milestone="0"] [data-action="refund"]').isVisible());
  await page.click('[data-testid="brief-panel"] summary');
  await page.click('[data-testid="brief-run"]');
  await page.waitForSelector('[data-testid="brief-panel"] [data-testid="evidence-items"] li');
  const brief = await page.locator('[data-testid="brief-panel"] .chip[data-status]').evaluateAll((els) => els.map((e) => e.dataset.status));
  check("the brief gives a status per condition and only brief statuses", brief.length >= 1 && brief.every((s) => ["supported", "contested", "not-addressed"].includes(s)), JSON.stringify(brief));
  const panelText = await page.locator('[data-testid="brief-panel"]').innerText();
  check("the brief states no ruling (no release or refund wording in its results)", !/\b(release|refund|ruling)\b/i.test(await page.locator('[data-testid="brief-panel"] [data-testid="evidence-items"]').innerText()), panelText.slice(0, 80));
  check("the arbiter's own Release and Refund buttons are still there: the arbiter rules", (await page.locator('[data-milestone="0"] [data-action="release"]').count()) === 1 && (await page.locator('[data-milestone="0"] [data-action="refund"]').count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, "brief-open.png"), fullPage: false });

  check("nothing left the machine", seen.external.size === 0, [...seen.external].join(", "));
  check("no page errors", seen.errors.length === 0, seen.errors.join(" | "));
} catch (e) {
  console.error("E2E ERROR:", e.message);
  results.push(false);
} finally {
  await browser.close();
  try {
    execSync("npm run demo:reset", { cwd: ROOT, stdio: "ignore" });
    console.log("(demo reset)");
  } catch {
    console.log("(demo reset failed: run npm run demo:reset)");
  }
}
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
