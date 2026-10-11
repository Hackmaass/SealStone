// Captures the pitch deck's pictures from the REAL app: node web/e2e/capture-deck.mjs  (needs `npm run dev` running).
// Writes high-resolution JPEGs to docs/pitch/img/. It resets the demo first and leaves it reset.
import { execSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, launch, openReady } from "./lib/browser.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = path.join(ROOT, "docs", "pitch", "img");
mkdirSync(OUT, { recursive: true });
const VAULT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const reset = () => execSync("npm run demo:reset", { cwd: ROOT, stdio: "ignore" });
const hideToasts = () => document.addEventListener("DOMContentLoaded", () => {
  const st = document.createElement("style");
  st.textContent = ".toasts,.asst-fab{display:none!important}";
  document.head.appendChild(st);
});
async function shot(page, name, opts = {}) {
  const file = path.join(OUT, `${name}.jpg`);
  await page.screenshot({ path: file, type: "jpeg", quality: 90, ...opts });
  console.log(`✓ ${name}.jpg (${Math.round(statSync(file).size / 1024)} KB)`);
}

reset();
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
  await ctx.addInitScript(() => localStorage.setItem("mv.aiMode", "rules"));
  await ctx.addInitScript(hideToasts);
  const p = await ctx.newPage();

  // 1. the agreement studio: the AI's flagged terms, highlighted in the text, with Confirm locked
  await openReady(p, `${BASE}/agreement`, 'select[aria-label="Load a sample"]');
  await p.selectOption('select[aria-label="Load a sample"]', "krishilens.txt");
  await p.click('button:has-text("Extract")');
  await p.waitForSelector("text=Proposed checklist", { timeout: 30000 });
  await p.click('button:has-text("Resolve the issues")');
  await p.waitForSelector("#cards .amb-card");
  await p.waitForTimeout(600);
  await shot(p, "studio-resolve");

  // 2. resolve every flag (one-click fixes), confirm, and show the seal
  const card = (id) => p.locator(`[data-ambiguity="${id}"]`);
  const chip = async (id, label) => card(id).locator(`button.fix:has-text("${label}")`).first().click();
  await chip("CONDITIONAL_AMOUNT:2:0", "ETH (total");
  await chip("CONDITIONAL_AMOUNT:1:0", "Remove the conditional clause");
  await chip("SUBJECTIVE_APPROVAL:1:0", "Replace with: A live demo");
  await chip("MISSING_DEADLINE:2:0", "Acknowledge");
  await card("AMOUNT_MISMATCH:agreement:0").waitFor();
  await chip("AMOUNT_MISMATCH:agreement:0", "Set the total to");
  await p.waitForTimeout(500);
  await shot(p, "studio-resolved");
  await p.click('.gate button:has-text("Review confirmed terms")');
  await p.waitForSelector("text=Confirmed terms");
  await p.click('button:has-text("Confirm terms")');
  await p.waitForSelector("text=Agreement seal");
  await p.waitForTimeout(900);
  await shot(p, "studio-confirmed");

  // 3. the demo vault as the client: the swapped file is refused
  await openReady(p, `${BASE}/vault/${VAULT}`, ".ms-row");
  await p.waitForSelector('[data-testid="terms-badge"][data-result="verified"]', { timeout: 15000 });
  await p.waitForTimeout(500);
  await shot(p, "vault-client");
  await p.click('[data-milestone="0"] [data-action="approve"]');
  await p.locator('.sheet label.file:has-text("m1-report-v2.pdf") input').check();
  await p.waitForSelector('.sheet .verdict:has-text("Different files")');
  await p.waitForTimeout(500);
  await shot(p, "approve-different");
  await p.click('.sheet button:has-text("Send anyway")');
  await p.waitForSelector(".ms-row .compare.mini");
  await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelector('[data-milestone="0"]').scrollIntoView({ block: "start" }));
  await p.evaluate(() => window.scrollBy(0, -90));
  await p.waitForTimeout(400);
  await shot(p, "vault-refused");

  // 4. the verify panel: edit one character of the confirmed terms
  await openReady(p, `${BASE}/vault/${VAULT}`, ".ms-row");
  await p.waitForSelector('[data-testid="terms-badge"][data-result="verified"]', { timeout: 15000 });
  await p.locator(".terms-panel summary").click();
  await p.click('.terms-panel button:has-text("Check this text")');
  await p.waitForSelector('[data-testid="probe-result"][data-result="verified"]');
  const json = await p.inputValue('textarea[aria-label="Confirmed terms JSON"]');
  await p.fill('textarea[aria-label="Confirmed terms JSON"]', json.replace("Problem validation report", "Problem validation reporT"));
  await p.click('.terms-panel button:has-text("Check this text")');
  await p.waitForSelector('[data-testid="probe-result"][data-result="mismatch"]');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector(".terms-panel").scrollIntoView({ block: "start" }));
  await p.evaluate(() => window.scrollBy(0, -100));
  await p.waitForTimeout(300);
  await shot(p, "verify-mismatch");
} finally {
  await browser.close();
  reset();
}
