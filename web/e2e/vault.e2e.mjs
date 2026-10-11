// Vault screen end to end on the PRE-SEEDED vault (demo steps 6-9 + Verify). Run `npm run demo:reset` first.
// Needs: chain, server and web running. Usage: node web/e2e/vault.e2e.mjs [shots-dir]
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { walkVault } from "./vaultWalk.mjs";

const BASE = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const SHOTS = process.argv[2] ?? path.resolve("e2e-shots");
mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const deployment = JSON.parse(readFileSync(new URL("../src/generated/deployment.json", import.meta.url), "utf8"));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text()}`));
const external = new Set();
page.on("request", (r) => {
  const u = new URL(r.url());
  if (!["127.0.0.1", "localhost"].includes(u.hostname) && !["data:", "blob:", "about:"].includes(u.protocol)) external.add(r.url());
});

try {
  await page.goto(`${BASE}/vault/${deployment.preseededVault.address}`);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await walkVault(page, {
    seeded: true,
    shot: (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }),
    log: (m) => console.log(`✓ ${m}`),
  });
  // A demo reset redeploys the vault at the SAME address. Refusals rehearsed before it must not reappear afterwards,
  // and sessionStorage is deliberately NOT cleared here (a real rehearsal tab keeps it).
  const rejectedBefore = await page.locator(".activity li.bad").count();
  if (rejectedBefore < 1) throw new Error("the rehearsal should have left rejected attempts in the activity list");
  const errorsBeforeReset = errors.length;
  execSync("npm run demo:reset", { cwd: fileURLToPath(new URL("../../", import.meta.url)), stdio: "ignore" });
  // A reset while the page is open must not break it: the dev server reloads the page by itself (no manual reload yet).
  await page.waitForSelector('[data-milestone="0"][data-state="Completed"]', { timeout: 30000 });
  const brokeOnReset = errors.slice(errorsBeforeReset).filter((e) => e.startsWith("pageerror:"));
  if (brokeOnReset.length) throw new Error(`the open page broke when the demo was reset: ${brokeOnReset.join(" | ")}`);
  console.log("✓ the open page recovered by itself when the demo was reset");
  await page.reload();
  await page.waitForSelector('[data-milestone="0"][data-state="Completed"]', { timeout: 20000 });
  await page.waitForTimeout(600);
  const rejectedAfter = await page.locator(".activity li.bad").count();
  if (rejectedAfter !== 0) throw new Error(`a reset vault must open clean, but ${rejectedAfter} old rejected attempts reappeared`);
  console.log(`✓ after a demo reset the vault opens clean (${rejectedBefore} rehearsal refusals did not come back)`);

  if (external.size) throw new Error(`requests left the machine:\n${[...external].join("\n")}`);
  if (errors.length) throw new Error(`browser errors:\n${errors.join("\n")}`);
  console.log("VAULT E2E PASSED");
} catch (e) {
  await page.screenshot({ path: path.join(SHOTS, "vault-failure.png") }).catch(() => {});
  console.error("VAULT E2E FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
