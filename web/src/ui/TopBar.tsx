import { id } from "ethers";
import { useApp } from "../lib/app";
import { ACCOUNT_ROLES, accountAddress } from "../lib/chain";
import { navigate, usePath } from "../lib/router";
import { HashSeal } from "./components";
import { formatWei, shortHash } from "./copy";
import type { Mode } from "../lib/api";
import deployment from "../generated/deployment.json";

const BRAND_HASH = id("milestonevault");
const ROLE_WORD = { client: "Client", provider: "Provider", arbiter: "Arbiter", stranger: "Anyone" } as const;
const MODES: Array<[Mode, string]> = [
  ["auto", "Auto"],
  ["ollama", "Ollama"],
  ["gemini", "Gemini"],
  ["rules", "Rules (offline)"],
];

export function TopBar() {
  const app = useApp();
  const path = usePath();
  const nav = (to: string, label: string, active: boolean) => (
    <button key={to} aria-current={active ? "page" : "false"} onClick={() => navigate(to)}>
      {label}
    </button>
  );
  const sourceLabel = app.lastAi ? { ollama: "Ollama", gemini: "Gemini", rules: "Rules" }[app.lastAi.source] : null;
  const aiTitle = app.lastAi
    ? `Last answer: ${sourceLabel}${app.lastAi.model ? ` · ${app.lastAi.model}` : ""} · ${(app.lastAi.latencyMs / 1000).toFixed(1)} s`
    : "Which AI to use for extraction";
  return (
    <header className="topbar">
      <div className="brand">
        <HashSeal hash={BRAND_HASH} state="onchain" size={28} />
        MilestoneVault
      </div>
      <nav className="nav" aria-label="Main">
        {nav("/agreement", "Agreement", path === "/agreement")}
        {nav(`/vault/${deployment.preseededVault.address}`, "Vault", path.startsWith("/vault/"))}
        {nav("/attack-lab", "Attack Lab", path === "/attack-lab")}
      </nav>
      <div className="spacer" />
      <label className="pill" title={aiTitle}>
        <span className="dot amber" />
        AI:
        <select aria-label="AI mode" value={app.aiMode} onChange={(e) => app.setAiMode(e.target.value as Mode)} style={{ border: 0, background: "transparent", padding: 0 }}>
          {MODES.map(([m, label]) => (
            <option key={m} value={m}>
              {label}
            </option>
          ))}
        </select>
        {sourceLabel && <span className="muted answered">answered: {sourceLabel}</span>}
      </label>
      <span className="pill" title="Local Hardhat chain">
        <span className="dot" style={app.chainOnline ? undefined : { background: "var(--revert)" }} />
        Chain: block{" "}
        <span className="mono" id="block">
          {app.block ?? "—"}
        </span>
      </span>
      <div className="roles" role="group" aria-label="Acting as">
        {ACCOUNT_ROLES.map((r, i) => {
          const bal = app.balances[r];
          return (
            <button
              key={r}
              data-role={r}
              aria-pressed={app.roleIdx === i}
              onClick={() => app.setRoleIdx(i)}
              title={`${shortHash(accountAddress(r))}${bal !== null ? ` · ${formatWei(bal, 2)} ETH` : ""} (key ${i + 1})`}
            >
              <span className="r">{ROLE_WORD[r]}</span>
              <span className="n">{app.names[r]}</span>
            </button>
          );
        })}
      </div>
      <button className="iconbtn" aria-pressed={app.presenter} onClick={app.togglePresenter} title="Presenter mode (P)">
        Presenter
      </button>
      <button className="iconbtn" onClick={app.toggleTheme} title="Toggle theme (T)">
        Theme
      </button>
    </header>
  );
}
