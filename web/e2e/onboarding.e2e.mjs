// First-run experience, in a real browser: landing -> Launch app -> connect screen -> connect -> guided tour -> remembered.
// Checks the honest wallet prompt (a detected extension is never called), every tour stop points at a real, visible element, the tour
// never sends a transaction, skip / Escape / deep links / chain-down all work, a phone and reduced motion are fine, text contrast is
// COMPUTED, and nothing leaves this machine. Needs `npm run dev`. Usage: node web/e2e/onboarding.e2e.mjs [shots-dir]
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BASE, DESKTOP, PHONE, launch, openReady, watch } from "./lib/browser.mjs";
import { contrastOf } from "./lib/contrast.mjs";

const SHOTS = process.argv[2] ?? path.resolve("e2e-shots/onboarding");
mkdirSync(SHOTS, { recursive: true });
const deployment = JSON.parse(readFileSync(new URL("../src/generated/deployment.json", import.meta.url), "utf8"));
const VAULT = `/vault/${deployment.preseededVault.address}`;
const TOUR_SRC = readFileSync(new URL("../src/lib/onboarding.ts", import.meta.url), "utf8");
const STEPS = [...TOUR_SRC.matchAll(/^ {4}id: "([a-z-]+)"/gm)].map((m) => m[1]);
const ANCHOR = Object.fromEntries(TOUR_SRC.split('    id: "').slice(1).map((blk) => [/^([a-z-]+)"/.exec(blk)[1], /anchor: '([^']*)'/.exec(blk)?.[1] ?? null]));
const log = (m) => console.log(`✓ ${m}`);
const fail = (m) => {
  throw new Error(m);
};
const check = (cond, msg) => cond || fail(msg);
// this machine sometimes refuses a loopback request for a moment (see lib/browser.mjs), so a read is retried
async function rpc(method) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(deployment.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }) });
      return await r.json();
    } catch (e) {
      if (i >= 6) throw e;
      await new Promise((res) => setTimeout(res, 400));
    }
  }
}

// a browser extension that records every call it receives: the local app must never touch it
const SPY_WALLET = () => {
  window.__walletCalls = [];
  window.ethereum = { isMetaMask: true, request: (a) => (window.__walletCalls.push(a.method), Promise.reject(new Error("not for this app"))), on() {}, removeListener() {} };
};

const browser = await launch({ onboarded: false });
const allSeen = [];
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const gateReady = (page, url) => openReady(page, url, '[data-testid="wallet-gate"]', { timeout: 8000 });
const noOverflow = async (page, where) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(o <= 1, `${where}: the page scrolls sideways by ${o}px`);
};
const stepOf = (page) => page.getAttribute('[data-testid="tour"]', "data-step");
async function waitStep(page, id) {
  await page.waitForSelector(`[data-testid="tour"][data-step="${id}"]`, { timeout: 8000 });
  if (!["welcome", "done"].includes(id)) {
    await page.waitForSelector(`[data-testid="tour"][data-step="${id}"][data-phase="found"]`, { timeout: 9000 }).catch(() => {});
  }
  await page.waitForTimeout(800); // let the spotlight and the card finish moving
}
const cardBox = (page) => page.locator('[data-testid="tour-card"]').boundingBox();
const holeBox = (page) => page.locator(".tour-hole").boundingBox();

try {
  // ═════════════ 1. a first visit on a laptop ═════════════
  const ctx = await browser.newContext({ ...DESKTOP, viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(SPY_WALLET);
  const page = await ctx.newPage();
  const seen = watch(page);
  allSeen.push(seen);
  await openReady(page, `${BASE}/`, ".lp-hero", { timeout: 8000 });
  await page.locator(".lp-nav-cta .lp-btn", { hasText: "Launch app" }).click();
  await page.waitForSelector('[data-testid="wallet-gate"]', { timeout: 8000 });
  check(new URL(page.url()).pathname === "/dashboard", "Launch app should open the dashboard behind the connect screen");
  check((await page.locator(".sidebar").count()) === 0, "the app must not render behind the connect screen");
  log("Launch app opens the connect screen, and the app is not rendered behind it");

  check((await page.locator('input[name="og-acct"]').count()) === 4, "the demo wallet should offer the four test accounts");
  const gateText = await page.locator(".og-card").innerText();
  check(/MetaMask detected/.test(gateText) && /Not used in this local demo/.test(gateText), `a detected extension should be shown and described honestly: ${gateText.slice(0, 300)}`);
  check(/Continue to the dashboard|continue to the dashboard/i.test(gateText), "the screen should say where you are heading");
  check((await page.locator('a[href="/mst-deploy.html"]').count()) === 1, "it should point real-wallet users at the MST deploy page");
  await page.waitForTimeout(1500);
  await shot(page, "01-connect-desktop");
  log("the connect screen lists the four test accounts, names the detected extension and says plainly it isn't used");

  // contrast, dark (the app's default theme)
  for (const sel of [".og-lede", ".og-sub", ".og-acct-t .small", ".og-fine", ".og-badge"]) {
    const r = await contrastOf(page, sel, { bar: 0, pill: sel === ".og-badge" });
    check(r === null || r >= 4.5, `connect screen ${sel}: contrast ${r?.toFixed(2)}:1 is under 4.5:1`);
  }
  log("connect screen text contrast is at least 4.5:1 (dark)");

  // choose the provider, connect
  await page.locator('label.og-acct[data-role="provider"]').click();
  await page.click('[data-testid="gate-connect"]');
  await page.waitForSelector('[data-testid="gate-connect"]:has-text("Opening")', { timeout: 3000 });
  await page.waitForSelector('[data-testid="wallet-gate"]', { state: "detached", timeout: 8000 });
  check((await page.evaluate(() => window.__walletCalls.length)) === 0, `the app called the browser wallet: ${await page.evaluate(() => JSON.stringify(window.__walletCalls))}`);
  check((await page.locator('[data-role="provider"][aria-pressed="true"]').count()) === 1, "connecting as the provider should start the app as the provider");
  log("Connect starts the app as the chosen account, and the browser extension was never called");

  // ═════════════ 2. the full tour ═════════════
  await waitStep(page, "welcome");
  await shot(page, "02-tour-welcome");
  const blockBefore = (await rpc("eth_blockNumber")).result;
  await page.click('[data-testid="tour-full"]');
  const visited = [];
  for (let i = 1; i < STEPS.length; i++) {
    const id = STEPS[i];
    await waitStep(page, id);
    visited.push(id);
    check((await stepOf(page)) === id, `expected step ${id}`);
    if (!["done"].includes(id)) {
      const hole = await holeBox(page);
      const card = await cardBox(page);
      const phase = await page.getAttribute('[data-testid="tour"]', "data-phase");
      check(phase === "found", `step ${id}: the spotlight never found its element (phase ${phase})`);
      check(hole && hole.width > 20 && hole.height > 20, `step ${id}: no spotlight`);
      check(card && card.x >= 0 && card.y >= 0 && card.x + card.width <= 1367 && card.y + card.height <= 769, `step ${id}: the card leaves the window ${JSON.stringify(card)}`);
      // the spotlight really sits on the element the step points at
      const overlap = await page.evaluate((sel) => {
        const visible = [...document.querySelectorAll(sel)].find((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (!visible) return null;
        const a = visible.getBoundingClientRect();
        const h = document.querySelector(".tour-hole").getBoundingClientRect();
        const w = Math.min(a.right, h.right) - Math.max(a.left, h.left);
        const hh = Math.min(a.bottom, h.bottom) - Math.max(a.top, h.top);
        return Math.max(0, w) * Math.max(0, hh) / Math.max(1, Math.min(a.width * a.height, h.width * h.height));
      }, ANCHOR[id]);
      check(overlap !== null && overlap > 0.6, `step ${id}: the spotlight (${JSON.stringify(hole)}) is not on its element (overlap ${overlap})`);
    }
    if (id === "roles") {
      await page.keyboard.press("3");
      await page.waitForSelector('.tour-live:has-text("Arbiter")', { timeout: 3000 });
      await page.keyboard.press("1");
      await page.waitForSelector('.tour-live:has-text("Client")', { timeout: 3000 });
      log("the role step updates live when you press a role key");
    }
    if (id === "ai") {
      const t = await page.locator(".tour-card").innerText();
      for (const w of ["Auto", "Ollama", "Gemini", "Rules (offline)"]) check(t.includes(w), `the AI step should mention ${w}`);
      check(/AI mode:/.test(t), "the AI step should show the current mode");
      await shot(page, "03-tour-ai");
    }
    if (id === "money") await shot(page, "04-tour-money");
    if (id === "studio-paste") await shot(page, "05-tour-studio");
    if (id === "milestones") await shot(page, "06-tour-milestones");
    if (id === "lab") await shot(page, "07-tour-lab");
    if (id === "done") break;
    await page.click('[data-testid="tour-next"]');
  }
  check(visited.join() === STEPS.slice(1).join(), `the tour visited ${visited.join(", ")}`);
  check((await rpc("eth_blockNumber")).result === blockBefore, "the tour changed chain state (the block number moved)");
  log(`the full tour visits all ${STEPS.length} stops in order, each spotlight finds its element, the card stays on screen, and the chain does not move`);

  await shot(page, "08-tour-done");
  for (const sel of [".tour-title", ".tour-body", ".tour-keys", ".tour-door span"]) {
    const r = await contrastOf(page, sel, { bar: 0 });
    check(r === null || r >= 4.5, `tour ${sel}: contrast ${r?.toFixed(2)}:1 is under 4.5:1`);
  }
  log("tour text contrast is at least 4.5:1 (dark)");

  await page.click('[data-testid="tour-go-0"]'); // Open the demo vault
  await page.waitForSelector('[data-testid="tour"]', { state: "detached", timeout: 5000 });
  check(new URL(page.url()).pathname === VAULT, `the finish button should open the demo vault, got ${page.url()}`);
  check((await page.evaluate(() => localStorage.getItem("mv.onboard.tour"))) === "done", "finishing should be remembered");
  log("the finish screen's buttons go where they say, and finishing is remembered");

  // ═════════════ 3. remembered, replayable, disconnectable ═════════════
  await page.reload();
  await page.waitForSelector(".vault-page, .panel", { timeout: 8000 });
  await page.waitForTimeout(1200);
  check((await page.locator('[data-testid="wallet-gate"], [data-testid="tour"]').count()) === 0, "after finishing, a reload should show neither the connect screen nor the tour");
  await page.keyboard.press("?");
  await waitStep(page, "welcome");
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="tour"]', { state: "detached", timeout: 5000 });
  check(new URL(page.url()).pathname === VAULT, "leaving a replayed tour should put you back where you were");
  log("a reload shows nothing again; ? replays the tour and Escape leaves it exactly where you were");

  await page.click('[data-testid="wallet-button"]');
  await shot(page, "09-wallet-menu");
  await page.click('[data-testid="wallet-disconnect"]');
  await page.waitForSelector('[data-testid="wallet-gate"]', { timeout: 5000 });
  check((await page.evaluate(() => localStorage.getItem("mv.onboard.wallet"))) === null, "disconnect should forget the wallet");
  log("the wallet menu disconnects and brings the connect screen back");

  // ═════════════ 4. skip, deep links ═════════════
  const skipCtx = await browser.newContext({ ...DESKTOP, viewport: { width: 1366, height: 768 } });
  const sp = await skipCtx.newPage();
  allSeen.push(watch(sp));
  await gateReady(sp, `${BASE}/attack-lab`);
  check(/the Attack Lab/.test(await sp.locator(".og-lede").innerText()), "the connect screen should say it is continuing to the Attack Lab");
  await sp.keyboard.press("Escape");
  await sp.waitForSelector(".lab-page", { timeout: 10000 });
  check((await sp.locator('[data-testid="tour"]').count()) === 0, "Escape on the connect screen should skip the tour");
  check((await sp.locator('[data-role="client"][aria-pressed="true"]').count()) === 1, "skipping starts as the client");
  check(new URL(sp.url()).pathname === "/attack-lab", "skipping should keep the page you were heading to");
  log("Escape skips setup, keeps the destination (the Attack Lab) and starts as the client");

  const deepCtx = await browser.newContext({ ...DESKTOP, viewport: { width: 1366, height: 768 } });
  const dp = await deepCtx.newPage();
  allSeen.push(watch(dp));
  await gateReady(dp, `${BASE}${VAULT}`);
  await dp.click('[data-testid="gate-connect"]');
  await waitStep(dp, "welcome");
  await dp.click('[data-testid="tour-skip-welcome"]');
  await dp.waitForSelector('[data-testid="tour"]', { state: "detached", timeout: 5000 });
  check(new URL(dp.url()).pathname === VAULT, "a deep link must survive connecting and skipping the tour");
  await dp.waitForSelector('[data-tour="milestones"]', { timeout: 10000 });
  log("a deep link to a vault survives the connect screen and skipping the tour");

  // ═════════════ 5. the chain is down ═════════════
  const offCtx = await browser.newContext({ ...DESKTOP, viewport: { width: 1366, height: 768 } });
  await offCtx.route(`${deployment.rpcUrl.replace(/\/$/, "")}/**`, (r) => r.abort());
  await offCtx.route(deployment.rpcUrl, (r) => r.abort());
  const op = await offCtx.newPage();
  await gateReady(op, `${BASE}/dashboard`);
  await op.waitForSelector('[data-testid="gate-offline"]', { timeout: 15000 });
  await shot(op, "10-connect-chain-down");
  await op.click('[data-testid="gate-connect"]');
  await op.waitForSelector('[data-testid="wallet-gate"]', { state: "detached", timeout: 10000 });
  await waitStep(op, "welcome");
  log("with the chain unreachable the connect screen says so and still lets you continue");

  // ═════════════ 6. a phone ═════════════
  const phCtx = await browser.newContext({ ...PHONE });
  const ph = await phCtx.newPage();
  allSeen.push(watch(ph));
  await gateReady(ph, `${BASE}/dashboard`);
  await ph.waitForTimeout(1200);
  await noOverflow(ph, "phone connect screen");
  await shot(ph, "11-connect-phone");
  const radios = await ph.locator("label.og-acct").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check(radios.every((h) => h >= 44), `account rows are too small to tap on a phone: ${radios}`);
  await ph.click('[data-testid="gate-connect"]');
  await waitStep(ph, "welcome");
  await ph.click('[data-testid="tour-full"]');
  let foundRoles = false;
  for (let i = 1; i < STEPS.length; i++) {
    const id = STEPS[i];
    await waitStep(ph, id);
    await noOverflow(ph, `phone step ${id}`);
    const card = await cardBox(ph);
    check(card && card.x >= 0 && card.y >= 0 && card.x + card.width <= 391 && card.y + card.height <= 845, `phone step ${id}: the card leaves the screen ${JSON.stringify(card)}`);
    if (id === "roles") foundRoles = (await ph.getAttribute('[data-testid="tour"]', "data-phase")) === "found";
    if (["roles", "ai", "milestones"].includes(id)) await shot(ph, `12-phone-${id}`);
    if (id === "done") break;
    await ph.click('[data-testid="tour-next"]');
  }
  check(foundRoles, "on a phone the roles step should spotlight the 'acting as' chip");
  // the phone menu's own entries: replay the tour, then disconnect
  await ph.click('[data-testid="tour"] .linklike:has-text("Close")');
  await ph.waitForSelector('[data-testid="tour"]', { state: "detached", timeout: 5000 });
  await ph.click('button[data-tour="menu"]');
  await ph.click('.phone-menu .pm-row:has-text("Take the tour")');
  await waitStep(ph, "welcome");
  await ph.keyboard.press("Escape");
  await ph.waitForSelector('[data-testid="tour"]', { state: "detached", timeout: 5000 });
  await ph.click('button[data-tour="menu"]');
  await ph.click('.phone-menu .pm-row:has-text("Disconnect")');
  await ph.waitForSelector('[data-testid="wallet-gate"]', { timeout: 5000 });
  log("on a phone: nothing scrolls sideways, rows are tappable, every card stays on screen, the roles step spotlights the chip");

  // ═════════════ 7. reduced motion, light theme ═════════════
  const rmCtx = await browser.newContext({ ...DESKTOP, viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  await rmCtx.addInitScript(() => localStorage.setItem("mv.theme", "light"));
  const rp = await rmCtx.newPage();
  allSeen.push(watch(rp));
  await gateReady(rp, `${BASE}/dashboard`);
  const running = await rp.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.target?.closest?.(".og")).length);
  check(running === 0, `reduced motion: ${running} animation(s) still running on the connect screen`);
  for (const sel of [".og-lede", ".og-sub", ".og-acct-t .small", ".og-badge"]) {
    const r = await contrastOf(rp, sel, { bar: 0, pill: sel === ".og-badge" });
    check(r === null || r >= 4.5, `light connect screen ${sel}: contrast ${r?.toFixed(2)}:1`);
  }
  await shot(rp, "13-connect-light");
  await rp.click('[data-testid="gate-connect"]');
  await waitStep(rp, "welcome");
  await rp.click('[data-testid="tour-quick"]');
  for (let i = 0; i < 20 && (await stepOf(rp)) !== "done"; i++) {
    await rp.waitForTimeout(250);
    if ((await stepOf(rp)) === "done") break;
    for (const sel of [".tour-body", ".tour-note", ".tour-chip"]) {
      const r = await contrastOf(rp, sel, { bar: 0, pill: sel === ".tour-chip", inset: sel === ".tour-note" ? 6 : 0 }); // the note has a 3px accent bar at its left edge, which is not its background
      check(r === null || r >= 4.5, `light tour ${sel} (${await stepOf(rp)}): contrast ${r?.toFixed(2)}:1`);
    }
    await rp.click('[data-testid="tour-next"]');
    await rp.waitForTimeout(400);
  }
  await waitStep(rp, "done");
  const offset = await rp.evaluate(() => getComputedStyle(document.querySelector(".tour-stamp .ring")).strokeDashoffset);
  check(parseFloat(offset) === 0, `reduced motion: the finish stamp should show complete, dash offset ${offset}`);
  await shot(rp, "14-done-light");
  log("reduced motion shows every animation's finished state, and the light theme keeps contrast at least 4.5:1 through the quick tour");

  // ═════════════ 8. nothing leaves the machine, nothing errors ═════════════
  for (const s of allSeen) {
    check(s.external.size === 0, `requests left this machine: ${[...s.external].join(", ")}`);
    check(s.errors.length === 0, `console/page errors: ${s.errors.join(" | ")}`);
  }
  log("no external requests and no console errors");
  console.log(`\nAll onboarding checks passed. Screenshots: ${SHOTS}`);
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  for (const s of allSeen) if (s.refused.length) console.error(`  refused requests: ${s.refused.slice(0, 8).join(" ; ")}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
