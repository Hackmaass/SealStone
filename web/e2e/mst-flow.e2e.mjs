// The MST deploy page, end to end with a fake wallet: connect, add MST testnet, deploy a vault, read the agreement hash back.
// The "wallet" forwards to a THROWAWAY local node (default http://127.0.0.1:8546, start it with `npx hardhat node --port 8546` in contracts/)
// and reports chainId 91562037, so nothing touches the real MST network and the demo chain on 8545 is never used.
// Usage: WEB_URL=http://localhost:4173 node web/e2e/mst-flow.e2e.mjs   (works against the dev server or a production build)
import { BASE, launch, openReady, watch } from "./lib/browser.mjs";

const NODE = process.env.MST_TEST_NODE ?? "http://127.0.0.1:8546";
const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Hardhat account #0, unlocked on the throwaway node
const PROVIDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ARBITER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const results = [];
const check = (name, ok, extra = "") => (results.push(ok), console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`));

let id = 0;
const rpc = async (method, params = []) => {
  const r = await fetch(NODE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
  return j.result;
};

const browser = await launch();
try {
  const page = await (await browser.newContext()).newPage();
  const seen = watch(page);
  const sent = [];
  await page.exposeFunction("__forward", async (method, params) => {
    if (method === "eth_sendTransaction") { sent.push(method); params = [{ ...params[0], chainId: undefined }]; }
    return rpc(method, params);
  });
  await page.addInitScript(`
    const ACCOUNT = "${ACCOUNT}";
    window.__calls = [];
    const provider = { request: async ({ method, params }) => {
      window.__calls.push(method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNT];
      if (method === "eth_chainId") return "0x5752035";
      if (method === "net_version") return "91562037";
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "wallet_addEthereumChain") return null;
      return window.__forward(method, params ?? []);
    } };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "bk-1", name: "BridgeKey", icon: "", rdns: "test.bridgekey" }, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
  `);
  await openReady(page, `${BASE}/mst-deploy.html`, "#sel-wallet:has(option[value='bk-1'])");
  check("BridgeKey is listed and preselected", (await page.inputValue("#sel-wallet")) === "bk-1");
  await page.click("#btn-connect");
  await page.waitForFunction(() => document.querySelector("#wallet-status")?.textContent?.startsWith("Connected"));
  check("connects on MST testnet (chainId 91562037)", /91562037/.test(await page.textContent("#wallet-status")));
  await page.fill("#in-provider", PROVIDER);
  await page.fill("#in-arbiter", ARBITER);
  check("Deploy enables with three distinct parties", !(await page.isDisabled("#btn-deploy")));
  const before = Number(await rpc("eth_blockNumber"));
  await page.click("#btn-deploy");
  await page.waitForFunction(() => /^(Deployed|Not deployed)/.test(document.querySelector("#deploy-status")?.textContent ?? ""), null, { timeout: 90000 });
  const status = await page.textContent("#deploy-status");
  check("deploys and the stored hash matches", /^Deployed\. The chain's stored agreement hash matches/.test(status), status.slice(0, 120));
  const after = Number(await rpc("eth_blockNumber"));
  check("exactly one deploy transaction was sent, and mined", sent.length === 1 && after > before, `${sent.length} tx, blocks ${before} to ${after}`);
  check("makes no request outside the page host and the local test node", [...seen.external].length === 0, [...seen.external].join(", "));
  check("no page errors", seen.errors.length === 0, seen.errors.join(" | "));
} finally {
  await browser.close();
}
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
