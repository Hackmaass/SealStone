// Landing page + app shell smoke test: every picture loads, every call-to-action reaches a real page, the phone menu works,
// nothing overflows sideways at phone / tablet / laptop widths, the seal demo really changes, text contrast is COMPUTED (not eyeballed),
// and nothing talks to the internet. Needs `npm run dev`. Usage: node web/e2e/landing.e2e.mjs [shots-dir]
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BASE, DESKTOP, PHONE, launch, openReady, watch } from "./lib/browser.mjs";

const SHOTS = process.argv[2] ?? path.resolve("e2e-shots");
mkdirSync(SHOTS, { recursive: true });
const deployment = JSON.parse(readFileSync(new URL("../src/generated/deployment.json", import.meta.url), "utf8"));
const VAULT = `/vault/${deployment.preseededVault.address}`;
const log = (m) => console.log(`✓ ${m}`);
const fail = (m) => {
  throw new Error(m);
};

const browser = await launch();
let page;
let seen;
try {
  // ───────────── laptop ─────────────
  const ctx = await browser.newContext({ ...DESKTOP, viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  page = await ctx.newPage();
  seen = watch(page);
  const loads = await openReady(page, `${BASE}/`, ".lp-hero", { timeout: 8000 });
  log(`the landing page renders${loads > 1 ? ` (needed ${loads} loads: this machine refused a request)` : ""}`);
  if (!/Sealstone/.test(await page.title())) fail(`unexpected title ${await page.title()}`);

  // 1. every picture loads, including the lazy ones (scroll the whole page first)
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 700) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(600);
  const imgs = await page.evaluate(() => [...document.images].map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0, alt: i.alt })));
  const broken = imgs.filter((i) => !i.ok);
  if (broken.length) fail(`pictures that did not load: ${JSON.stringify(broken)}`);
  if (imgs.some((i) => !i.alt || i.alt.length < 15)) fail("every picture needs a real description (alt text)");
  if (imgs.length < 8) fail(`expected the 8 product pictures on the page, saw ${imgs.length}`);
  log(`all ${imgs.length} product pictures load and have descriptions`);

  // 2. no sideways scroll at three widths
  for (const w of [1366, 768, 390]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(250);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) fail(`the landing page scrolls sideways by ${over}px at ${w}px wide`);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  log("no horizontal scrolling on the landing page at 1366, 768 and 390 px");

  // 3. the seal demo really computes
  await page.evaluate(() => document.querySelector("#demo").scrollIntoView());
  const verdict = () => page.locator('[data-testid="seal-verdict"]').innerText();
  await page.waitForFunction(() => /Same file/.test(document.querySelector('[data-testid="seal-verdict"]')?.textContent ?? ""));
  const START = "m1-report.pdf (demo)";
  const want = createHash("sha256").update(START).digest("hex");
  const expectShort = `0x${want.slice(0, 4)}…${want.slice(-4)}`;
  const shown = await page.locator(".lp-seal-hash").first().innerText();
  if (shown !== expectShort) fail(`the demo shows ${shown} but SHA-256 of "${START}" is ${expectShort}`);
  const sealBefore = await page.locator(".lp-seal-art svg").nth(1).innerHTML();
  await page.click('[data-testid="seal-change"]');
  await page.waitForFunction(() => /Different files/.test(document.querySelector('[data-testid="seal-verdict"]')?.textContent ?? ""));
  const sealAfter = await page.locator(".lp-seal-art svg").nth(1).innerHTML();
  if (sealBefore === sealAfter) fail("changing one letter must change the drawn seal");
  const hashAfter = await page.locator(".lp-seal-hash").nth(1).innerText();
  const changed = START.slice(0, -1) + ")".replace(")", "]");
  const wantB = createHash("sha256").update(changed).digest("hex");
  if (hashAfter !== `0x${wantB.slice(0, 4)}…${wantB.slice(-4)}`) fail(`after the change the demo shows ${hashAfter}, expected the SHA-256 of "${changed}"`);
  await page.getByRole("button", { name: "Start over" }).click();
  await page.waitForFunction(() => /Same file/.test(document.querySelector('[data-testid="seal-verdict"]')?.textContent ?? ""));
  log(`seal demo: real SHA-256 (${expectShort}), one changed letter => different seal and "${(await verdict()).includes("Same") ? "Same" : "?"} file" again after Start over`);

  // 4. the audience tabs work
  await page.getByRole("tab", { name: "For teams and programmes" }).click();
  if (!(await page.locator('[role="tabpanel"]').innerText()).includes("dashboard")) fail("the teams tab should talk about the dashboard");
  await page.getByRole("tab", { name: "For freelancers and clients" }).click();
  log("the freelancer / team tabs switch their content");

  // 5. the FAQ opens
  await page.locator("#faq details").first().locator("summary").click();
  if (!(await page.locator("#faq details[open]").count())) fail("an FAQ answer should open");
  log("the FAQ accordion opens");

  // 6. text contrast, computed from what is really painted behind each piece of text
  const CONTRAST = [".lp-hero .lp-lede", ".lp-reassure", ".lp-promise p", ".lp-strip", ".lp-strip-note", ".lp-demo .lp-sub", ".lp-seal-meta", ".lp-fine-inline", ".lp-show .lp-lede", ".lp-for .lp-lede", ".lp-checks li", ".lp-example p", ".lp-step p", ".lp-sub", ".lp-limits li", ".lp-stat p", ".lp-check-link", ".lp-acc details p", ".lp-fine", ".lp-foot-brand p", ".lp-footer ul li", ".lp-dark .lp-lede", ".lp-layer p", ".lp-tag", ".lp-final .lp-lede"];
  const worst = [];
  for (const sel of CONTRAST) {
    const el = page.locator(sel).first();
    if (!(await el.count())) continue;
    // centre it (so the sticky bar is not on top of it) and measure only what is really on screen
    await el.evaluate((n) => n.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(200);
    const box = await el.boundingBox();
    if (!box || box.width < 4 || box.height < 4) continue;
    const info = await el.evaluate((node) => {
      // read the real colour FIRST (a live style object would report "transparent" once we hide the text)
      const color = getComputedStyle(node).color;
      node.style.setProperty("color", "transparent", "important");
      node.querySelectorAll("*").forEach((c) => c.style.setProperty("color", "transparent", "important"));
      return { color };
    });
    const x0 = Math.max(0, box.x), y0 = Math.max(76, box.y); // 76px = the sticky bar
    const clip = { x: x0, y: y0, width: Math.max(4, Math.min(box.x + box.width, 1366) - x0), height: Math.max(4, Math.min(box.y + box.height, 768) - y0) };
    const png = await page.screenshot({ clip });
    await el.evaluate((node) => {
      node.style.removeProperty("color");
      node.querySelectorAll("*").forEach((c) => c.style.removeProperty("color"));
    });
    const ratio = await page.evaluate(async ([b64, color]) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const g = cv.getContext("2d");
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      const lum = ([r, gg, b]) => {
        const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b);
      };
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
      const fg = lum([+m[1], +m[2], +m[3]]);
      let min = 21;
      // the background pixel that is CLOSEST in brightness to the text is the worst case
      for (let i = 0; i < d.length; i += 4 * 7) {
        const L = lum([d[i], d[i + 1], d[i + 2]]);
        const r = (Math.max(fg, L) + 0.05) / (Math.min(fg, L) + 0.05);
        if (r < min) min = r;
      }
      return min;
    }, [png.toString("base64"), info.color]);
    worst.push([sel, Math.round(ratio * 100) / 100]);
  }
  const low = worst.filter(([, r]) => r < 4.5);
  if (low.length) fail(`text below the 4.5:1 contrast minimum: ${JSON.stringify(low)}`);
  log(`text contrast computed for ${worst.length} text blocks: lowest ${Math.min(...worst.map(([, r]) => r))}:1 (minimum 4.5:1)`);
  await page.screenshot({ path: path.join(SHOTS, "landing-laptop.png") });

  // 7. every call-to-action reaches a real page
  const internal = await page.evaluate(() => [...new Set([...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("/") && !h.startsWith("//")))]);
  const routes = internal.filter((h) => h !== "/");
  const expected = new Set(["/dashboard", "/vaults", "/agreement", "/attack-lab", VAULT]);
  for (const r of routes) if (!expected.has(r)) fail(`unexpected internal link ${r}`);
  for (const r of routes) {
    await openReady(page, `${BASE}${r}`, ".topbar", { timeout: 8000 });
    const h1 = await page.locator("h1").first().innerText().catch(() => "");
    if (!h1 || /not found/i.test(h1)) fail(`${r} did not show a real page (h1: "${h1}")`);
  }
  log(`every landing link reaches a real page: ${routes.join(", ")}`);
  await openReady(page, `${BASE}/`, ".lp-hero", { timeout: 8000 });
  await page.getByRole("link", { name: "Launch app" }).first().click();
  await page.waitForSelector('[data-testid="dash-stats"]', { timeout: 15000 });
  if (new URL(page.url()).pathname !== "/dashboard") fail(`Launch app went to ${page.url()}`);
  log('"Launch app" opens the dashboard without a page reload');

  // ───────────── phone ─────────────
  const phone = await browser.newContext({ ...PHONE, reducedMotion: "reduce" });
  const p = await phone.newPage();
  const pseen = watch(p);
  await openReady(p, `${BASE}/`, ".lp-hero", { timeout: 8000 });
  await p.click(".lp-burger");
  await p.waitForSelector('.lp-menu[role="dialog"]');
  await p.locator(".lp-menu").getByRole("link", { name: "Who it's for" }).click();
  await p.waitForSelector(".lp-menu", { state: "detached" });
  const reached = await p.evaluate(() => document.querySelector("#for").getBoundingClientRect().top);
  if (reached > 200) fail(`the menu link did not scroll to the section (top ${reached}px)`);
  await p.click(".lp-burger");
  await p.keyboard.press("Escape");
  await p.waitForSelector(".lp-menu", { state: "detached" });
  log("the landing phone menu opens, navigates to a section, and closes (Escape too)");

  // the app on a phone: menu + no sideways scroll on every page
  for (const route of ["/dashboard", "/vaults", VAULT, "/agreement", "/attack-lab"]) {
    await openReady(p, `${BASE}${route}`, ".topbar", { timeout: 8000 });
    await p.waitForTimeout(900);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) fail(`${route} scrolls sideways by ${over}px on a phone`);
  }
  log("no horizontal scrolling on the dashboard, vaults, vault, agreement studio or Attack Lab at 390 px");
  await openReady(p, `${BASE}/dashboard`, ".topbar", { timeout: 8000 });
  await p.click(".menu-btn.phone-only");
  await p.waitForSelector('.phone-menu[role="dialog"]');
  await p.getByRole("button", { name: "Vaults", exact: true }).click();
  await p.waitForSelector(".filters");
  if (await p.locator(".phone-menu").count()) fail("the app menu should close after choosing a page");
  log("the app's phone menu opens, navigates and closes");

  // ───────────── the whole run ─────────────
  for (const [who, s] of [["laptop", seen], ["phone", pseen]]) {
    if (s.external.size) fail(`${who}: requests left the machine:\n${[...s.external].join("\n")}`);
    if (s.errors.length) fail(`${who}: browser errors:\n${s.errors.join("\n")}`);
  }
  log("no console errors, and every request stayed on 127.0.0.1");
  console.log("LANDING E2E PASSED");
} catch (e) {
  await page?.screenshot({ path: path.join(SHOTS, "landing-failure.png") }).catch(() => {});
  console.error("LANDING E2E FAILED:", e.message);
  if (seen?.refused.length) console.error("FAILED NETWORK REQUESTS (refused by the environment, not an app error):\n" + seen.refused.slice(0, 8).join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
}
