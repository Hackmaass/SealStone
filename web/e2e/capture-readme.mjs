// Captures the README's pictures from the REAL app (never mock-ups): `npm run capture:readme`  (needs `npm run dev` running).
// Writes JPEGs to docs/screenshots/. It resets the demo first, disputes milestone 1 for the last picture, and resets the demo again at the end.
// The app is put in light theme and the offline "Rules" AI mode so every picture is reproducible without any key or model
// (the evidence brief picture is therefore the built-in rules reading; with Sarvam or Ollama configured it quotes more precisely).
import { execSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, launch, openReady } from "./lib/browser.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = path.join(ROOT, "docs", "screenshots");
mkdirSync(OUT, { recursive: true });
const VAULT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
// This machine sometimes refuses a loopback connection for a request or two; a reset is safe to repeat.
const reset = () => {
  for (let i = 1; ; i++) {
    try {
      return execSync("npm run demo:reset", { cwd: ROOT, stdio: "ignore" });
    } catch (e) {
      if (i >= 5) throw e;
    }
  }
};
const HIDE = "hide-for-pictures";
const hideChrome = () =>
  document.addEventListener("DOMContentLoaded", () => {
    const st = document.createElement("style");
    st.id = "hide-for-pictures";
    st.textContent = ".toasts,.asst-fab{display:none!important}";
    document.head.appendChild(st);
  });
async function shot(page, name, opts = {}) {
  const file = path.join(OUT, `${name}.jpg`);
  await page.screenshot({ path: file, type: "jpeg", quality: 86, ...opts });
  console.log(`✓ ${name}.jpg (${Math.round(statSync(file).size / 1024)} KB)`);
}
const role = async (p, n) => {
  await p.locator("body").click({ position: { x: 5, y: 300 } });
  await p.keyboard.press(String(n));
  await p.waitForTimeout(600);
};

reset();
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    localStorage.setItem("mv.aiMode", "rules");
    localStorage.setItem("mv.theme", "light");
  });
  await ctx.addInitScript(hideChrome);
  const p = await ctx.newPage();

  // 1. the landing page
  await openReady(p, `${BASE}/`, ".lp-hero", { timeout: 8000 });
  await p.waitForTimeout(900);
  await shot(p, "01-landing");

  // 2. the agreement studio: the AI's flagged terms, highlighted in the text, with Confirm locked
  await openReady(p, `${BASE}/agreement`, 'select[aria-label="Load a sample"]');
  await p.selectOption('select[aria-label="Load a sample"]', "krishilens.txt");
  await p.click('button:has-text("Extract")');
  await p.waitForSelector("text=Proposed checklist", { timeout: 30000 });
  await p.click('button:has-text("Resolve the issues")');
  await p.waitForSelector("#cards .amb-card");
  await p.waitForTimeout(700);
  await shot(p, "02-studio-flags");

  // 3. every flag resolved by a person, then confirmed and sealed
  const card = (id) => p.locator(`[data-ambiguity="${id}"]`);
  const chip = async (id, label) => card(id).locator(`button.fix:has-text("${label}")`).first().click();
  await chip("CONDITIONAL_AMOUNT:2:0", "ETH (total");
  await chip("CONDITIONAL_AMOUNT:1:0", "Remove the conditional clause");
  await chip("SUBJECTIVE_APPROVAL:1:0", "Replace with: A live demo");
  await chip("MISSING_DEADLINE:2:0", "Acknowledge");
  await card("AMOUNT_MISMATCH:agreement:0").waitFor();
  await chip("AMOUNT_MISMATCH:agreement:0", "Set the total to");
  await p.waitForTimeout(500);
  await p.click('.gate button:has-text("Review confirmed terms")');
  await p.waitForSelector("text=Confirmed terms");
  await p.click('button:has-text("Confirm terms")');
  await p.waitForSelector("text=Agreement seal");
  await p.waitForTimeout(1000);
  await shot(p, "03-studio-sealed");

  // 4. the dashboard
  await openReady(p, `${BASE}/dashboard`, "h1");
  await p.waitForTimeout(2800);
  await shot(p, "04-dashboard");

  // 5. the demo vault, then the swapped file
  await openReady(p, `${BASE}${"/vault/" + VAULT}`, ".ms-row");
  await p.waitForSelector('[data-testid="terms-badge"][data-result="verified"]', { timeout: 15000 });
  await p.waitForTimeout(600);
  await shot(p, "05-vault");
  await p.click('[data-milestone="0"] [data-action="approve"]');
  await p.locator('.sheet label.file:has-text("m1-report-v2.pdf") input').check();
  await p.waitForSelector('.sheet .verdict:has-text("Different files")');
  await p.waitForTimeout(600);
  await shot(p, "06-swapped-file");
  await p.click('.sheet button:has-text("Send anyway")');
  await p.waitForSelector(".ms-row .compare.mini");
  await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelector('[data-milestone="0"]').scrollIntoView({ block: "start" }));
  await p.evaluate(() => window.scrollBy(0, -90));
  await p.waitForTimeout(400);
  await shot(p, "07-refused");

  // 6. the Attack Lab after "Run all", with the same-attack-two-escrows card
  await openReady(p, `${BASE}/attack-lab`, '[data-testid="run-all"]');
  await p.click('[data-testid="run-all"]');
  await p.waitForFunction(() => document.querySelector('[data-testid="run-all"]')?.textContent?.trim() === "Run all attacks", null, { timeout: 180000 });
  await p.waitForSelector(".duel-grid");
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(700);
  await shot(p, "08-attack-lab");

  // 7. the assistant: it only suggests
  await openReady(p, `${BASE}/dashboard`, "h1");
  await p.evaluate((id) => document.getElementById(id)?.remove(), HIDE);
  await p.addStyleTag({ content: ".toasts{display:none!important}" });
  await p.click(".asst-fab");
  await p.fill('input[aria-label="Message the assistant"]', "What's next for me?");
  await p.click('.asst-form button[type="submit"]');
  await p.waitForSelector('.asst-act[data-action="openVault"]');
  await p.waitForTimeout(500);
  await shot(p, "09-assistant");
  await p.keyboard.press("Escape");

  // 8. the arbiter's evidence brief (dispute milestone 1, then act as the arbiter)
  await openReady(p, `${BASE}/vault/${VAULT}`, ".ms-row");
  await p.waitForSelector('[data-milestone="0"] [data-action="dispute"]', { timeout: 20000 });
  await p.click('[data-milestone="0"] [data-action="dispute"]');
  await p.fill(".sheet textarea", "The report we received is only 6 pages long and covers interviews with just 7 farmers. It lists three diseases, not a ranking of the five most common ones.");
  await p.click(".sheet button.go");
  await p.waitForSelector('[data-milestone="0"][data-state="Disputed"]', { timeout: 30000 });
  await role(p, 3);
  await p.waitForSelector('[data-testid="brief-panel"]');
  await p.click('[data-testid="brief-panel"] summary');
  await p.fill("#ev-provider", "The report runs to 9 pages. We interviewed 12 farmers across three villages. Section 3 ranks the five most common crop diseases by how often farmers reported them.");
  await p.click('[data-testid="brief-run"]');
  await p.waitForSelector('[data-testid="brief-panel"] [data-testid="evidence-items"] li', { timeout: 60000 });
  await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('[data-testid="brief-panel"]').scrollIntoView({ block: "start" }));
  await p.evaluate(() => window.scrollBy(0, -100));
  await p.waitForTimeout(400);
  await shot(p, "10-evidence-brief");
} finally {
  await browser.close();
  try {
    reset();
    console.log("(demo reset)");
  } catch {
    console.log("(demo reset failed: run npm run demo:reset)");
  }
}
