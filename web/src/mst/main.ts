import "@fontsource-variable/inter";
import "../ui/tokens.css";
import "./mst.css";
import { BrowserProvider, type Eip1193Provider } from "ethers";
import { deployVault } from "../lib/deploy";
import { buildChecklist, checkParties, MST } from "./mst";
import { scanInjected, walletLikeKeys, type Wallet } from "./wallets";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Wallets come from EIP-6963 announcements and from scanInjected (window.ethereum and friends); re-scanned because some extensions inject late. */
const wallets = new Map<string, Wallet>();
const announced = new Set<string>();
let ethereum: Eip1193Provider | undefined;
const setText = (id: string, text: string) => ($(id).textContent = text);

function renderWallets(): void {
  for (const w of scanInjected(window as unknown as Record<string, unknown>)) {
    if (![...wallets.values()].some((x) => x.provider === w.provider)) wallets.set(w.id, w);
  }
  const sel = $<HTMLSelectElement>("sel-wallet");
  const previous = sel.value;
  sel.replaceChildren();
  if (wallets.size === 0) sel.add(new Option("No wallet found yet", ""));
  for (const [id, w] of wallets) sel.add(new Option(w.name, id));
  // Prefer a wallet whose name mentions BridgeKey, else keep the earlier choice.
  const bridgekey = [...wallets].find(([, w]) => /bridge\s*key/i.test(w.name));
  sel.value = wallets.has(previous) ? previous : (bridgekey?.[0] ?? sel.options[0]?.value ?? "");
  renderDiagnostics();
}

function renderDiagnostics(): void {
  const win = window as unknown as Record<string, unknown>;
  const lines = [
    `Page address: ${location.href}`,
    `EIP-6963 wallets announced: ${announced.size ? [...announced].join(", ") : "none"}`,
    `window.ethereum: ${win.ethereum ? "present" : "absent"}`,
    `Wallets in the list: ${wallets.size}`,
    `Wallet-like window properties: ${walletLikeKeys(win).join(", ") || "none"}`,
    `Browser: ${navigator.userAgent}`,
  ];
  setText("diagnostics", lines.join("\n"));
}

function requestAnnouncements(): void {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  renderWallets();
}

window.addEventListener("eip6963:announceProvider", (e) => {
  const { info, provider } = (e as CustomEvent<{ info: { uuid: string; name: string }; provider: Eip1193Provider }>).detail;
  announced.add(info.name);
  wallets.set(info.uuid, { id: info.uuid, name: info.name, provider, source: "EIP-6963" });
  renderWallets();
});
window.addEventListener("ethereum#initialized", requestAnnouncements);
window.addEventListener("load", requestAnnouncements);
requestAnnouncements();
// Some extensions inject a moment after the page loads: look again for a few seconds, then stop.
let scans = 0;
const scanTimer = window.setInterval(() => {
  requestAnnouncements();
  if (++scans >= 20 || wallets.size > 0) window.clearInterval(scanTimer);
}, 500);

let account = "";
let record: unknown = null;

function refreshParties(): void {
  const check = checkParties(account, $<HTMLInputElement>("in-provider").value.trim(), $<HTMLInputElement>("in-arbiter").value.trim());
  const deploy = $<HTMLButtonElement>("btn-deploy");
  if (!check.ok) {
    setText("hash-preview", `Agreement hash: ${check.reason}`);
    deploy.disabled = true;
    return;
  }
  const { hash } = buildChecklist(account, check.provider, check.arbiter);
  setText("hash-preview", `Agreement hash: ${hash}`);
  deploy.disabled = false;
}

async function connect(): Promise<void> {
  requestAnnouncements();
  ethereum = wallets.get($<HTMLSelectElement>("sel-wallet").value)?.provider;
  if (!ethereum) {
    setText("wallet-status", "No wallet found. Open the checklist below (extension enabled, site access allowed), then press Rescan.");
    return;
  }
  try {
    const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
    account = accounts[0] ?? "";
    await switchToMst();
    $<HTMLInputElement>("in-client").value = account;
    setText("wallet-status", `Connected: ${account} on ${MST.name} (chainId ${MST.chainId}).`);
    refreshParties();
  } catch (e) {
    setText("wallet-status", `Could not connect: ${(e as Error).message}`);
  }
}

/** Switch to MST testnet, adding it to the wallet if it is not known yet. */
async function switchToMst(): Promise<void> {
  try {
    await ethereum!.request({ method: "wallet_switchEthereumChain", params: [{ chainId: MST.chainIdHex }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await ethereum!.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: MST.chainIdHex,
          chainName: MST.name,
          rpcUrls: [MST.rpc],
          nativeCurrency: { name: MST.symbol, symbol: MST.symbol, decimals: 18 },
          blockExplorerUrls: [MST.explorer],
        },
      ],
    });
  }
}

async function deploy(): Promise<void> {
  const btn = $<HTMLButtonElement>("btn-deploy");
  btn.disabled = true;
  try {
    const check = checkParties(account, $<HTMLInputElement>("in-provider").value.trim(), $<HTMLInputElement>("in-arbiter").value.trim());
    if (!check.ok) throw new Error(check.reason);
    const provider = new BrowserProvider(ethereum!);
    const chainId = Number((await provider.getNetwork()).chainId);
    if (chainId !== MST.chainId) throw new Error(`Wrong network (chainId ${chainId}). Switch your wallet to ${MST.name} (${MST.chainId}).`);
    const signer = await provider.getSigner();
    if (signer.address.toLowerCase() !== account.toLowerCase()) {
      throw new Error("The wallet's active account changed. Reconnect and try again.");
    }

    const { confirmed, hash } = buildChecklist(account, check.provider, check.arbiter);
    setText("deploy-status", "Confirm the deploy transaction in your wallet…");
    const { address, txHash } = await deployVault(confirmed, hash, signer);

    record = {
      network: "mst-testnet",
      chainId: MST.chainId,
      contract: "MilestoneVault",
      address,
      deployTx: txHash,
      agreementHash: hash,
      parties: { client: account, provider: check.provider, arbiter: check.arbiter },
      explorer: { address: `${MST.explorer}/address/${address}`, tx: `${MST.explorer}/tx/${txHash}` },
      deployedAt: new Date().toISOString(),
    };
    setText("res-address", address);
    setText("res-tx", txHash);
    $<HTMLAnchorElement>("res-explorer-address").href = `${MST.explorer}/address/${address}`;
    $<HTMLAnchorElement>("res-explorer-tx").href = `${MST.explorer}/tx/${txHash}`;
    $("result").hidden = false;
    setText("deploy-status", "Deployed. The chain's stored agreement hash matches the one above.");
  } catch (e) {
    setText("deploy-status", `Not deployed: ${(e as Error).message}`);
  } finally {
    btn.disabled = false;
  }
}

function download(): void {
  const blob = new Blob([JSON.stringify(record, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mst-testnet.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

$("btn-rescan").addEventListener("click", requestAnnouncements);
$("btn-connect").addEventListener("click", () => void connect());
$("btn-deploy").addEventListener("click", () => void deploy());
$("btn-download").addEventListener("click", download);
$("in-provider").addEventListener("input", refreshParties);
$("in-arbiter").addEventListener("input", refreshParties);
