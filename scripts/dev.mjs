// `npm run dev`: start the local chain, the AI service and the web app together, seed the demo vault once the chain
// is up, and print where everything is. Plain Node (no new dependency), works on Windows, macOS and Linux.
// Anything already running on its port is reused instead of crashing with "address in use".
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const RPC = "http://127.0.0.1:8545";
const API = "http://127.0.0.1:8787";
const WEB = "http://127.0.0.1:5173";
const isWin = process.platform === "win32";
const children = [];

const say = (m = "") => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(800, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

async function rpcUp() {
  try {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }), signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitFor(check, what, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(500);
  }
  throw new Error(`${what} did not come up within ${Math.round(ms / 1000)} s`);
}

function start(name, script) {
  const child = spawn("npm", ["run", script], { cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const prefix = `[${name}] `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) out.write(prefix + l + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (!stopping) say(`[${name}] stopped (exit ${code}). Press Ctrl+C to end the rest.`);
  });
  children.push(child);
  return child;
}

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  say("\nStopping Sealstone…");
  for (const c of children) {
    if (c.exitCode !== null || !c.pid) continue;
    if (isWin) spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

function runOnce(script) {
  const r = spawnSync("npm", ["run", script], { cwd: ROOT, shell: true, stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error(`npm run ${script} failed (exit ${r.status})`);
}

async function main() {
  say("Starting Sealstone (local chain, AI service, web app)…");

  const chainWasUp = await rpcUp();
  if (chainWasUp) say(`  chain: already running at ${RPC}, reusing it`);
  else start("chain", "chain");

  if (await portOpen(8787)) say(`  AI service: already running at ${API}, reusing it`);
  else start("ai", "server");

  if (await portOpen(5173)) say(`  web: already running at ${WEB}, reusing it`);
  else start("web", "web");

  await waitFor(rpcUp, "The local chain");
  // The UI polls the chain every second; Hardhat would print every call and bury this screen. (Re-enable: hardhat_setLoggingEnabled true.)
  await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "hardhat_setLoggingEnabled", params: [false] }) }).catch(() => {});
  // A chain that was already running may hold old state, so reset it; a brand-new chain is simply seeded.
  say(chainWasUp ? "Resetting and re-seeding the demo vault…" : "Seeding the demo vault…");
  runOnce(chainWasUp ? "demo:reset" : "deploy:demo");

  await waitFor(() => portOpen(5173), "The web app");
  let ai = "AI service is starting";
  try {
    const h = await (await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(4000) })).json();
    ai = h.providers?.ollama ? `Ollama ready (${h.models.ollama.configured}); built-in rules always available` : "Ollama not available, using the built-in rules (that is fine, and fully offline)";
  } catch {
    /* the AI service may still be booting; the web app shows its own banner if it is down */
  }
  const dep = JSON.parse(readFileSync(new URL("../web/src/generated/deployment.json", import.meta.url), "utf8"));
  say("");
  say("┌─ Sealstone is ready ─────────────────────────────────────────────");
  say(`│  Open the app      ${WEB}`);
  say(`│  Demo vault        ${WEB}/vault/${dep.preseededVault.address}`);
  say(`│  Attack Lab        ${WEB}/attack-lab`);
  say(`│  AI                ${ai}`);
  say(`│  Chain             ${RPC} (local Hardhat, test ETH only)`);
  say("│  Reset the demo    npm run demo:reset      Stop everything: Ctrl+C");
  say("└──────────────────────────────────────────────────────────────────");
}

main().catch((e) => {
  console.error(`\nCould not start: ${e.message}`);
  stopAll();
  process.exitCode = 1;
});
