// The MST deploy page finds wallets (EIP-6963, window.ethereum, late injection) and connects. A fake wallet stands in: no chain, no keys.
import { BASE, launch, openReady, watch } from "./lib/browser.mjs";

const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const fakeWallet = `
  const calls = [];
  window.__calls = calls;
  const provider = { request: async ({ method, params }) => {
    calls.push(method);
    if (method === "eth_requestAccounts") return ["${ACCOUNT}"];
    if (method === "wallet_switchEthereumChain") { const e = new Error("unknown chain"); e.code = 4902; throw e; }
    if (method === "wallet_addEthereumChain") return null;
    return null;
  } };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "x-1", name: "BridgeKey", icon: "", rdns: "test.bridgekey" }, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
`;

/** Opens the page and retries until its script has run (it fills #diagnostics): this machine sometimes refuses a loopback module request. */
async function openScripted(page) {
  for (let i = 0; i < 8; i++) {
    await page.goto(`${BASE}/mst-deploy.html`).catch(() => {});
    if (await page.waitForFunction(() => document.querySelector("#diagnostics")?.textContent, null, { timeout: 4000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error("the page's script never ran");
}

const results = [];
const check = (name, ok) => (results.push({ name, ok }), console.log(`${ok ? "PASS" : "FAIL"} ${name}`));

const browser = await launch();
try {
  // 1. A wallet that announces itself via EIP-6963.
  let page = await (await browser.newContext()).newPage();
  const seen = watch(page);
  await page.addInitScript(fakeWallet);
  await openReady(page, `${BASE}/mst-deploy.html`, "#sel-wallet:has(option[value='x-1'])");
  check("lists an EIP-6963 wallet named BridgeKey and preselects it", (await page.inputValue("#sel-wallet")) === "x-1");
  await page.click("#btn-connect");
  await page.waitForFunction(() => document.querySelector("#wallet-status")?.textContent?.startsWith("Connected"));
  check("connects and adds MST testnet when the wallet does not know it", (await page.evaluate(() => window.__calls)).includes("wallet_addEthereumChain"));
  check("shows the connected account as client", (await page.inputValue("#in-client")) === ACCOUNT);
  await page.fill("#in-provider", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  await page.fill("#in-arbiter", "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
  check("enables Deploy only with two valid distinct addresses", !(await page.isDisabled("#btn-deploy")));
  await page.fill("#in-arbiter", ACCOUNT);
  check("keeps Deploy disabled when two parties are the same address", await page.isDisabled("#btn-deploy"));
  check("makes no request outside 127.0.0.1", seen.external.size === 0);
  check("has no page errors", seen.errors.length === 0);

  // 2. A wallet that only appears late as window.ethereum.
  page = await (await browser.newContext()).newPage();
  await openScripted(page);
  await page.evaluate(() => setTimeout(() => (window.ethereum = { request: async () => ["0x1"] }), 1200));
  await page.waitForFunction(() => document.querySelector("#sel-wallet option")?.textContent?.includes("window.ethereum"), null, { timeout: 8000 });
  check("finds a wallet injected late as window.ethereum", true);

  // 3. No wallet at all: says so and shows diagnostics.
  page = await (await browser.newContext()).newPage();
  await openScripted(page);
  await page.click("#btn-connect");
  check("explains when no wallet exists", /No wallet found/.test(await page.textContent("#wallet-status")));
  check("fills in the diagnostics", /window\.ethereum: absent/.test(await page.textContent("#diagnostics")));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} FAILED` : `all ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
