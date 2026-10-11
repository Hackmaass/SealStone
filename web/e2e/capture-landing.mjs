// Captures the landing page's pictures from the REAL app (never mock-ups): `npm run capture:landing`.
// Needs `npm run dev` running. It resets the demo, drives the real flows (phone and desktop layouts), writes
// web/public/landing/*.jpg, and leaves the demo reset. Re-run it whenever the UI changes so the pictures stay true.
import { execSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, DESKTOP, PHONE, launch, openReady } from "./lib/browser.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = path.join(ROOT, "web", "public", "landing");
mkdirSync(OUT, { recursive: true });
const VAULT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const reset = () => execSync("npm run demo:reset", { cwd: ROOT, stdio: "ignore" });
// Status toasts are transient and would sit on top of the pictures: keep them out of the frame.
const hideToasts = () => { document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = ".toasts{display:none!important}"; document.head.appendChild(st); }); };
const log = (m) => console.log(`✓ ${m}`);
const written = [];
async function shot(page, name, opts = {}) {
  const file = path.join(OUT, `${name}.jpg`);
  await page.screenshot({ path: file, type: "jpeg", quality: 88, ...opts });
  const kb = Math.round(statSync(file).size / 1024);
  written.push(`${name}.jpg ${kb} KB`);
  log(`${name}.jpg (${kb} KB)`);
}
/** Scrolls an element to just under the sticky bar, then lets animations settle. */
async function scrollTo(page, selector, offset = 84) {
  await page.evaluate(([sel, off]) => {
    const el = document.querySelector(sel);
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off);
  }, [selector, offset]);
  await page.waitForTimeout(500);
}

reset();
const browser = await launch();
try {
  // ───────────── phone layout ─────────────
  const phone = await browser.newContext({ ...PHONE, colorScheme: "light", reducedMotion: "reduce" });
  await phone.addInitScript(() => localStorage.setItem("mv.aiMode", "rules")); // the built-in rules: no AI needed for a picture
  await phone.addInitScript(hideToasts);
  await phone.addInitScript(() => localStorage.setItem("mv.theme", "light")); // the app starts dark; the landing pictures are light
  const p = await phone.newPage();

  // 1. the agreement studio: a flagged term, Confirm locked
  await openReady(p, `${BASE}/agreement`, 'select[aria-label="Load a sample"]');
  await p.selectOption('select[aria-label="Load a sample"]', "krishilens.txt");
  await p.click('button:has-text("Extract")');
  await p.waitForSelector("text=Proposed checklist", { timeout: 30000 });
  await p.click('button:has-text("Resolve the issues")');
  await p.waitForSelector("#cards .amb-card");
  await scrollTo(p, ".rail", 78);
  await shot(p, "phone-studio");

  // 2. the demo vault: milestone 1 waiting on the client
  await openReady(p, `${BASE}/vault/${VAULT}`, ".ms-row");
  await p.waitForSelector('[data-testid="terms-badge"][data-result="verified"]', { timeout: 15000 });
  await scrollTo(p, '[data-milestone="0"]', 76);
  await shot(p, "phone-milestone");

  // 3. the swapped file is refused (both seals shown)
  await p.click('[data-milestone="0"] [data-action="approve"]');
  await p.locator('.sheet label.file:has-text("m1-report-v2.pdf") input').check();
  await p.waitForSelector('.sheet .verdict:has-text("Different files")');
  await p.click('.sheet button:has-text("Send anyway")');
  await p.waitForSelector('.ms-row .compare.mini .verdict:has-text("Different files")');
  await scrollTo(p, '[data-milestone="0"]', 76);
  await shot(p, "phone-milestone-mismatch");

  // 4. the right file is approved: milestone 1 settled, the next one unlocked
  await p.click('[data-milestone="0"] [data-action="approve"]');
  await p.locator('.sheet label.file:has-text("m1-report.pdf") input').check();
  await p.waitForSelector('.sheet .verdict:has-text("Seals match")');
  await p.click('.sheet button:has-text("Approve and release")');
  await p.waitForSelector('[data-milestone="0"][data-state="Released"]', { timeout: 20000 });
  await scrollTo(p, ".ms", 76);
  await shot(p, "phone-milestones-settled");

  // 5. the ledger, reconciled, with money owed to the provider
  await scrollTo(p, ".ledger", 76);
  await shot(p, "phone-ledger");
  await phone.close();

  // ───────────── desktop layout ─────────────
  const desk = await browser.newContext({ ...DESKTOP, deviceScaleFactor: 1.5, colorScheme: "light", reducedMotion: "reduce" });
  await desk.addInitScript(hideToasts);
  await desk.addInitScript(() => localStorage.setItem("mv.theme", "light"));
  const d = await desk.newPage();

  // 6. the dashboard, as the provider (so something is waiting on them)
  await openReady(d, `${BASE}/dashboard`, '[data-testid="dash-stats"]');
  await d.locator("body").click({ position: { x: 4, y: 400 } });
  await d.keyboard.press("2");
  await d.waitForSelector('.vrow .tag', { timeout: 15000 });
  await d.waitForTimeout(700);
  await shot(d, "desktop-dashboard");

  // 7. the vault with its milestones, as the provider
  await openReady(d, `${BASE}/vault/${VAULT}`, ".ms-row");
  await d.waitForSelector('[data-testid="terms-badge"][data-result="verified"]', { timeout: 15000 });
  await d.waitForTimeout(700);
  await d.evaluate(() => window.scrollTo(0, 150));
  await d.waitForTimeout(400);
  await shot(d, "desktop-vault");

  // 8. the Attack Lab after a full run
  await openReady(d, `${BASE}/attack-lab`, '[data-testid="run-all"]');
  await d.click('[data-testid="run-all"]');
  await d.waitForFunction(() => document.querySelector('[data-testid="run-all"]')?.textContent?.trim() === "Run all attacks", null, { timeout: 180000 });
  await d.evaluate(() => window.scrollTo(0, 0));
  await d.waitForTimeout(600);
  await shot(d, "desktop-lab");
  await desk.close();
  console.log(`\nWrote ${written.length} pictures to web/public/landing:\n  ${written.join("\n  ")}`);
} finally {
  await browser.close();
  reset(); // leave the demo clean
}
