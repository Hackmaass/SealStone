// Shared by the browser scripts: launch Chrome, and open a page reliably.
// This machine sometimes refuses a loopback connection for a request or two (net::ERR_NETWORK_ACCESS_DENIED), which leaves a
// page empty. That is not the app, so opening a page retries until `ready` appears, and says how many loads it needed.
import { chromium } from "playwright-core";

export const BASE = process.env.WEB_URL ?? "http://127.0.0.1:5173";
export const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

/**
 * Marks a browser as "already onboarded" (wallet connected, tour done) so every script that opens the app lands on the app, not on the
 * first-run connect screen and tour. The onboarding script opts out with `launch({ onboarded: false })`.
 * The keys are the ones in src/lib/onboarding.ts.
 */
const ONBOARDED = () => {
  try {
    localStorage.setItem("mv.onboard.wallet", "demo");
    localStorage.setItem("mv.onboard.tour", "done");
  } catch {
    /* storage blocked */
  }
};

export async function launch({ onboarded = true } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  if (onboarded) {
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...args) => {
      const ctx = await newContext(...args);
      await ctx.addInitScript(ONBOARDED);
      return ctx;
    };
  }
  return browser;
}

export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const DESKTOP = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 };

/** Opens `url` and waits for the selector `ready`; reloads up to `tries` times. Returns the number of loads it took. */
export async function openReady(page, url, ready, { tries = 8, timeout = 4000 } = {}) {
  for (let i = 1; i <= tries; i++) {
    await page.goto(url).catch(() => {});
    if (await page.waitForSelector(ready, { timeout }).then(() => true).catch(() => false)) return i;
  }
  throw new Error(`${url} never showed ${ready} after ${tries} loads`);
}

/** Collects what a failing run needs to be diagnosed: console errors (minus dev-only noise), page errors, refused requests, external hosts. */
export function watch(page) {
  const seen = { errors: [], refused: [], external: new Set() };
  page.on("pageerror", (e) => seen.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebSocket|\[vite\]|@vite\/client|Failed to send error to Vite/.test(m.text()) && seen.errors.push(`console: ${m.text()}`));
  page.on("requestfailed", (r) => seen.refused.push(`${r.url().replace(BASE, "")} ${r.failure()?.errorText ?? ""}`));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["127.0.0.1", "localhost"].includes(u.hostname) && !["data:", "blob:", "about:"].includes(u.protocol)) seen.external.add(r.url());
  });
  return seen;
}
