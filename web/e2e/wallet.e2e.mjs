// WALLET MODE in a real browser: a browser wallet on "MST testnet" signs every transaction (a pop-up for each), from connect to withdraw.
// There is no real wallet and no real MST here, so two things stand in for them, and are the only fakes:
//  - FAKE WALLET: an EIP-1193 wallet (announced with EIP-6963, like an extension) that says it is on MST (chainId 0x5752035), records
//    every request, approves transactions by forwarding them to the local Hardhat node (which has unlocked accounts), and can switch
//    accounts, decline a request or change network when the test tells it to.
//  - MST RPC: Playwright answers the browser's calls to https://testnetrpc.mstblockchain.com with the local Hardhat node.
// What this proves is the APP's wallet path: connect only on a click, silent reconnect, account and network checks, deploy, sign,
// fund, submit, approve (including a refused swapped file), withdraw, and that nothing in wallet mode reads from 127.0.0.1:8545.
// What it can NOT prove: how real MetaMask/BridgeKey behave on the real MST testnet (the team checks that by hand).
// Needs `npm run dev` (the local node and the web app). Usage: node web/e2e/wallet.e2e.mjs [shots-dir]
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BASE, DESKTOP, launch, openReady, watch } from "./lib/browser.mjs";

const SHOTS = process.argv[2] ?? path.resolve("e2e-shots/wallet");
mkdirSync(SHOTS, { recursive: true });
const deployment = JSON.parse(readFileSync(new URL("../src/generated/deployment.json", import.meta.url), "utf8"));
const A = Object.fromEntries(["client", "provider", "arbiter", "stranger"].map((r) => [r, deployment.accounts[r].address]));
const LOCAL_RPC = deployment.rpcUrl;
const MST_RPC = "https://testnetrpc.mstblockchain.com";
const BACKEND = "https://fake-wallet-backend.test/rpc"; // what the fake wallet "talks to": routed to the local node below
const log = (m) => console.log(`✓ ${m}`);
const fail = (m) => {
  throw new Error(m);
};
const check = (c, m) => c || fail(m);

async function toLocalNode(body) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(LOCAL_RPC, { method: "POST", headers: { "content-type": "application/json" }, body });
      return await r.text();
    } catch (e) {
      if (i >= 6) throw e;
      await new Promise((res) => setTimeout(res, 300));
    }
  }
}
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" };
let mstReads = 0;
async function answerRpc(route) {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
  if (req.url().startsWith(MST_RPC)) mstReads++;
  await route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: await toLocalNode(req.postData() ?? "") });
}

/** The wallet. Runs in the page, before the app. State that must survive a reload (calls, account, chain) lives in sessionStorage. */
function installFakeWallet(cfg) {
  const ss = (k, v) => {
    try {
      if (v === undefined) return sessionStorage.getItem(k);
      sessionStorage.setItem(k, v);
    } catch {
      return null;
    }
  };
  const calls = JSON.parse(ss("__fwcalls") || "[]");
  const listeners = {};
  const emit = (ev, arg) => (listeners[ev] || []).forEach((f) => f(arg));
  const state = { account: ss("__fwacct") || cfg.accounts[0], chainId: Number(ss("__fwchain") || cfg.mstChainId), decline: false, knowsMst: true };
  const persist = () => {
    ss("__fwacct", state.account);
    ss("__fwchain", String(state.chainId));
    ss("__fwcalls", JSON.stringify(calls));
  };
  const forward = async (method, params) => {
    const r = await fetch(cfg.backend, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
    return j.result;
  };
  const wallet = {
    async request({ method, params = [] }) {
      calls.push(method);
      persist();
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [state.account];
        case "eth_chainId":
          return "0x" + state.chainId.toString(16);
        case "net_version":
          return String(state.chainId);
        case "wallet_switchEthereumChain":
          state.chainId = parseInt(params[0].chainId, 16);
          persist();
          emit("chainChanged", "0x" + state.chainId.toString(16));
          return null;
        case "wallet_addEthereumChain":
        case "wallet_revokePermissions":
          return null;
        case "eth_sendTransaction": {
          if (state.decline) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          const tx = { ...params[0] };
          delete tx.chainId; // Hardhat answers for chain 31337; a real wallet would sign for MST
          tx.from = state.account;
          return forward(method, [tx]);
        }
        default:
          return forward(method, params);
      }
    },
    on(ev, f) {
      (listeners[ev] ||= []).push(f);
    },
    removeListener(ev, f) {
      listeners[ev] = (listeners[ev] || []).filter((x) => x !== f);
    },
  };
  window.__fw = {
    state,
    calls,
    setAccount(a) {
      state.account = a;
      persist();
      emit("accountsChanged", [a]);
    },
    setChain(id) {
      state.chainId = id;
      persist();
      emit("chainChanged", "0x" + id.toString(16));
    },
    count: (m) => calls.filter((c) => c === m).length,
  };
  const icon = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" rx="7" fill="#f6851b"/></svg>');
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: "fake-uuid", name: "Fake Wallet", icon, rdns: "test.fakewallet" }, provider: wallet } }));
  window.addEventListener("eip6963:requestProvider", announce);
}

const browser = await launch({ onboarded: false });
let page;
let seen;
try {
  const ctx = await browser.newContext({ ...DESKTOP, viewport: { width: 1366, height: 800 } });
  await ctx.addInitScript(() => localStorage.getItem("mv.aiMode") ?? localStorage.setItem("mv.aiMode", "rules"));
  await ctx.addInitScript(installFakeWallet, { accounts: [A.client, A.provider, A.arbiter], backend: BACKEND, mstChainId: 91562037 });
  await ctx.route(/^https:\/\/testnetrpc\.mstblockchain\.com/, answerRpc);
  await ctx.route(/^https:\/\/fake-wallet-backend\.test/, answerRpc);
  page = await ctx.newPage();
  seen = watch(page);
  const fw = (expr) => page.evaluate(`(() => { const fw = window.__fw; return ${expr}; })()`);
  const sent = () => fw('fw.count("eth_sendTransaction")');
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const toastText = () => page.locator(".toasts").innerText().catch(() => "");

  // ═════════════ 1. connect: a click opens the wallet, nothing before it does ═════════════
  await openReady(page, `${BASE}/dashboard`, '[data-testid="wallet-gate"]', { timeout: 8000 });
  await page.waitForSelector('[data-testid="wallet-row"]', { timeout: 8000 });
  check((await page.locator('[data-testid="wallet-row"]').first().innerText()).includes("Fake Wallet"), "the detected wallet should be listed by name");
  await page.waitForTimeout(1500);
  check((await fw('fw.count("eth_requestAccounts")')) === 0, "the app asked the wallet for accounts before any click");
  check((await fw('fw.calls.filter((c) => c !== "eth_chainId").length')) === 0, `the app called the wallet before any click: ${await fw("fw.calls.join(',')")}`);
  await shot("01-gate-both-options");
  log("the connect screen lists the wallet and makes no wallet call until a click");

  await page.click('[data-testid="wallet-connect"]');
  await page.waitForSelector('[data-testid="wallet-checking"], [data-testid="tour"], .sidebar', { timeout: 15000 });
  await page.waitForSelector('[data-testid="tour"][data-step="welcome"]', { timeout: 20000 });
  const reqs = await fw('fw.count("eth_requestAccounts")');
  check(reqs === 1, `one click should mean exactly one connect request, saw ${reqs}`);
  check((await fw('fw.count("wallet_switchEthereumChain")')) >= 1, "connecting should switch the wallet to MST testnet");
  check((await fw('fw.count("eth_accounts")')) >= 1, "after the reload the wallet should be reconnected with eth_accounts");
  check((await fw('fw.state.chainId')) === 91562037, "the wallet should end on MST testnet");
  check((await page.locator('[data-testid="side-wallet"]').count()) === 1 && (await page.locator(".side-roles").count()) === 0, "wallet mode shows the wallet, not the role switcher");
  log("one click opened the wallet once; after the reload it came back silently (eth_accounts), on MST testnet, in wallet mode");

  // from here the page is in wallet mode: nothing may read from the local node
  let localReads = 0;
  page.on("request", (r) => r.url().startsWith(LOCAL_RPC) && localReads++);

  // the tour: wallet wording, no Attack Lab, no vault chapter yet
  await page.click('[data-testid="tour-full"]');
  const visited = [];
  for (let i = 0; i < 30; i++) {
    const id = await page.getAttribute('[data-testid="tour"]', "data-step");
    visited.push(id);
    if (id === "done") break;
    await page.waitForTimeout(500);
    await page.click('[data-testid="tour-next"]');
    await page.waitForFunction((prev) => document.querySelector('[data-testid="tour"]')?.getAttribute("data-step") !== prev, id, { timeout: 8000 });
  }
  check(visited.includes("ai") && visited.includes("roles") && visited.includes("studio-paste"), `the tour should still cover the AI model, roles and the studio: ${visited}`);
  check(!visited.some((s) => ["lab", "duel", "vault-seal", "milestones"].includes(s)), `no Attack Lab or vault chapter without a vault: ${visited}`);
  await shot("02-tour-done-wallet");
  await page.click('[data-testid="tour-go-0"]'); // Draft an agreement
  await page.waitForSelector('select[aria-label="Load a sample"]', { timeout: 10000 });
  log(`the tour adapts to wallet mode (${visited.length} stops: AI model and roles kept; Attack Lab and vault chapter left out)`);

  // ═════════════ 2. draft, confirm, with the wallet as the client ═════════════
  await page.selectOption('select[aria-label="Load a sample"]', "krishilens.txt");
  await page.click('button:has-text("Extract")');
  await page.waitForSelector("text=Proposed checklist", { timeout: 30000 });
  await page.click('button:has-text("Resolve the issues")');
  await page.waitForSelector("#cards .amb-card");
  const card = (id) => page.locator(`[data-ambiguity="${id}"]`);
  const chip = async (id, label) => card(id).locator(`button.fix:has-text("${label}")`).first().click();
  await chip("CONDITIONAL_AMOUNT:2:0", "ETH (total");
  await chip("CONDITIONAL_AMOUNT:1:0", "Remove the conditional clause");
  await chip("SUBJECTIVE_APPROVAL:1:0", "Replace with: A live demo");
  await chip("MISSING_DEADLINE:2:0", "Acknowledge");
  await card("AMOUNT_MISMATCH:agreement:0").waitFor();
  await chip("AMOUNT_MISMATCH:agreement:0", "Set the total to");
  await page.click('.gate button:has-text("Review confirmed terms")');
  await page.waitForSelector("text=Confirmed terms");
  check((await page.inputValue('input[aria-label="Wallet for the client"]')).toLowerCase() === A.client.toLowerCase(), "the client should be the connected wallet");
  check(await page.locator('input[aria-label="Wallet for the client"]').evaluate((e) => e.readOnly), "the client address should not be editable");
  check((await page.locator('select[aria-label="Wallet for the provider"]').count()) === 0, "wallet mode must not offer the local test accounts");
  await page.fill('input[aria-label="Wallet for the provider"]', A.provider);
  await page.fill('input[aria-label="Wallet for the arbiter"]', A.arbiter);
  await page.click('button:has-text("Confirm terms")');
  await page.waitForSelector("text=Agreement seal", { timeout: 15000 });
  await shot("03-confirmed-wallet-parties");
  log("the client is the connected wallet (read-only); provider and arbiter are typed in; the terms are confirmed and sealed");

  // ═════════════ 3. deploy: the wallet confirms ═════════════
  await page.click('button:has-text("Deploy and continue")');
  await page.waitForSelector('button:has-text("Deploy escrow contract")');
  check((await page.locator('[data-testid="account-hint"][data-ok="true"]').count()) === 1, "the deploy step should say the wallet is on the client's account");
  const before = await sent();
  await page.click('button:has-text("Deploy escrow contract")');
  await page.waitForSelector('.sealcard h2:has-text("Sign and fund")', { timeout: 30000 });
  check((await sent()) === before + 1, "deploying should be exactly one wallet transaction");
  const vaultAddress = (await page.locator("text=/Contract 0x[0-9a-fA-F]{40}/").first().innerText()).replace("Contract ", "").trim();
  log(`deployed through the wallet (1 transaction): ${vaultAddress}`);

  // ═════════════ 4. sign and fund: switching accounts between steps, declining, a wrong network ═════════════
  // declining the wallet's request sends nothing and says so
  await fw("(fw.state.decline = true)");
  await page.click('[data-signature="client"] button:has-text("Sign as client")');
  await page.waitForSelector('.toasts:has-text("nothing was sent")', { timeout: 8000 });
  check((await sent()) === before + 1, "a declined request must not send a transaction");
  await fw("(fw.state.decline = false)");
  log("declining in the wallet sends nothing and says 'nothing was sent'");

  // a wallet on another network is refused before anything is sent, and one click puts it back
  await fw("fw.setChain(1)");
  await page.waitForSelector('[data-testid="wrong-network"]', { timeout: 8000 });
  await page.click('[data-testid="wrong-network"] button');
  await page.waitForSelector('[data-testid="wrong-network"]', { state: "detached", timeout: 8000 });
  check((await fw("fw.state.chainId")) === 91562037, "the switch button should put the wallet back on MST testnet");
  log("a wallet on another network shows a banner; its button switches it back to MST testnet");

  await page.click('[data-signature="client"] button:has-text("Sign as client")');
  await page.waitForSelector('[data-signature="client"] .stamp-ok', { timeout: 30000 });
  check((await sent()) === before + 2, "signing as the client should be one transaction");

  // the provider's signature needs the provider's account: the wrong account is refused BEFORE any transaction
  check((await page.locator('[data-signature="provider"] [data-testid="account-hint"][data-ok="false"]').count()) === 1, "the provider card should ask for the provider's account");
  await page.click('[data-signature="provider"] button:has-text("Sign as provider")');
  await page.waitForSelector('.toasts:has-text("Switch accounts in your wallet")', { timeout: 8000 });
  check((await sent()) === before + 2, "a wrong account must be refused before any transaction is sent");
  await shot("04-wrong-account");
  await fw(`fw.setAccount("${A.provider}")`);
  await page.waitForSelector('[data-signature="provider"] [data-testid="account-hint"][data-ok="true"]', { timeout: 8000 });
  await page.click('[data-signature="provider"] button:has-text("Sign as provider")');
  await page.waitForSelector('[data-signature="provider"] .stamp-ok', { timeout: 30000 });
  log("the wrong account is refused before any transaction; switching accounts in the wallet updates the page by itself; both parties signed");

  await fw(`fw.setAccount("${A.client}")`);
  await page.waitForSelector('.panel.sigcard:has-text("Fund") [data-testid="account-hint"][data-ok="true"]', { timeout: 8000 });
  await page.click('button:has-text("Fund escrow")');
  await page.waitForSelector(".vault-page", { timeout: 30000 });
  await page.waitForSelector(".ms-row", { timeout: 20000 });
  const unit = await page.locator(".ledger").first().innerText();
  check(/tMSTC/.test(unit) && !/\bETH\b/.test(unit), `wallet mode should show tMSTC, not ETH:\n${unit}`);
  check(/the client of this vault/.test(await page.locator('[data-testid="your-move"]').innerText()), "the vault should recognise the wallet as the client by its address");
  log("the client funded the escrow through the wallet; the vault knows the wallet is the client and amounts read tMSTC");

  // ═════════════ 5. the vault, role by role (account by account) ═════════════
  const row = (i) => page.locator(`[data-milestone="${i}"]`);
  const state = (i, s) => page.waitForSelector(`[data-milestone="${i}"][data-state="${s}"]`, { timeout: 30000 });
  const pick = (name) => page.locator(`.sheet label.file:has-text("${name}") input`).check();
  const ledgerOk = async (why) => {
    const t = await page.locator(".ledger .stamp").innerText();
    check(/Reconciled/.test(t) && !/Does not/.test(t), `the ledger must stay reconciled ${why}: ${t}`);
  };
  await ledgerOk("after funding");

  await fw(`fw.setAccount("${A.provider}")`);
  await page.waitForSelector('[data-testid="your-move"]:has-text("the provider of this vault")', { timeout: 8000 });
  await row(0).locator('[data-action="markComplete"]').click();
  await pick("m1-report.pdf");
  await page.click('.sheet button:has-text("Submit work")');
  await state(0, "Completed");
  log("the provider (wallet on the provider's account) submitted milestone 1 with the file's real SHA-256");

  await fw(`fw.setAccount("${A.client}")`);
  await page.waitForSelector('[data-testid="your-move"]:has-text("the client of this vault")', { timeout: 8000 });
  const sendsBefore = await sent();
  await row(0).locator('[data-action="approve"]').click();
  await pick("m1-report-v2.pdf");
  await page.waitForSelector('.sheet .verdict:has-text("Different files")');
  await page.click('.sheet button:has-text("Send anyway")');
  await page.waitForSelector(`.ms-row .revert:has-text("isn't the file that was submitted")`, { timeout: 20000 });
  check((await sent()) === sendsBefore, "the contract refused the swapped file while the wallet estimated gas: no transaction should have been sent");
  await ledgerOk("after the swapped-file approval was refused");
  await shot("05-swapped-file-refused");
  log("a swapped file is refused by the contract through the wallet path, with its own error, and the ledger still balances");

  await row(0).locator('[data-action="approve"]').click();
  await pick("m1-report.pdf");
  await page.waitForSelector('.sheet .verdict:has-text("Seals match")');
  await page.click('.sheet button:has-text("Approve and release 1.000 tMSTC")');
  await state(0, "Released");
  await ledgerOk("after the approval");

  await fw(`fw.setAccount("${A.provider}")`);
  await page.waitForSelector('[data-action="withdraw"]', { timeout: 8000 });
  await page.click('[data-action="withdraw"]');
  await page.waitForSelector('.activity li:has-text("withdrew 1.000 tMSTC")', { timeout: 30000 });
  await ledgerOk("after the withdrawal");
  await shot("06-withdrawn");
  log("the client approved the exact file; the provider withdrew 1.000 tMSTC; the books balance");

  // ═════════════ 6. the rest of the app in wallet mode ═════════════
  await page.evaluate(() => (location.href = "/dashboard"));
  await page.waitForSelector('[data-testid="dash-stats"]', { timeout: 15000 });
  await page.waitForSelector(".vrow, .vrows li", { timeout: 15000 });
  check(/tMSTC/.test(await page.locator('[data-testid="dash-stats"]').innerText()), "the dashboard should total in tMSTC");
  await page.goto(`${BASE}/attack-lab`);
  await page.waitForSelector('[data-testid="lab-wallet-notice"]', { timeout: 10000 });
  log("the dashboard lists this browser's vault in tMSTC; the Attack Lab explains that it runs on the local chain only");

  await page.evaluate(() => localStorage.removeItem("mv.vaults.mst.v1"));
  await page.goto(`${BASE}/vaults`);
  await page.waitForSelector('[data-testid="open-vault"]', { timeout: 10000 });
  await page.fill('[data-testid="open-vault"] input', "0x1234");
  await page.click('[data-testid="open-vault"] button');
  await page.waitForSelector('[data-testid="open-vault"] [role="alert"]');
  await page.fill('[data-testid="open-vault"] input', vaultAddress);
  await page.click('[data-testid="open-vault"] button');
  await page.waitForSelector(".vault-page .ms-row", { timeout: 20000 });
  log("a vault can be opened by its address (a wrong address is refused first)");

  // ═════════════ 7. reload, disconnect ═════════════
  await page.reload();
  await page.waitForSelector(".vault-page .ms-row", { timeout: 20000 });
  check((await page.locator('[data-testid="wallet-gate"]').count()) === 0, "a reload should reconnect the wallet silently, not show the connect screen");
  check((await fw('fw.count("eth_requestAccounts")')) === 1, "no reload may ever open the connect pop-up again");
  await page.click('[data-testid="wallet-button"]');
  await page.click('[data-testid="wallet-disconnect"]');
  await page.waitForSelector('[data-testid="wallet-gate"]', { timeout: 8000 });
  check((await page.evaluate(() => localStorage.getItem("mv.onboard.walletId"))) === null, "disconnect should forget the wallet");
  log("a reload reconnects silently (still exactly one connect request in the whole session); Disconnect forgets the wallet");

  check(localReads === 0, `wallet mode read from the local node ${localReads} time(s)`);
  check(mstReads > 20, `reads should go to the MST RPC (saw ${mstReads})`);
  log(`wallet mode read from the MST RPC (${mstReads} calls) and never from ${LOCAL_RPC}`);
  check(seen.errors.length === 0, `console/page errors: ${seen.errors.join(" | ")}`);
  const outside = [...seen.external].filter((u) => !u.startsWith(MST_RPC) && !u.startsWith(BACKEND));
  check(outside.length === 0, `requests left this machine: ${outside.join(", ")}`);
  log("no console errors, and the only outside requests were to the MST RPC");
  console.log(`\nAll wallet-mode checks passed (fake wallet; local node standing in for MST). Screenshots: ${SHOTS}`);
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  if (seen?.refused.length) console.error(`  refused requests: ${seen.refused.slice(0, 8).join(" ; ")}`);
  if (page) await page.screenshot({ path: path.join(SHOTS, "failure.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
