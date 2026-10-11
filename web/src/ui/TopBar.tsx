import { useEffect, useState } from "react";
import { id } from "ethers";
import { useApp } from "../lib/app";
import { ACCOUNT_ROLES, accountAddress } from "../lib/chain";
import { link, navigate, usePath } from "../lib/router";
import { HashSeal } from "./components";
import { formatWei, shortHash } from "./copy";
import type { Mode } from "../lib/api";
import deployment from "../generated/deployment.json";

const BRAND_HASH = id("sealstone");
const ROLE_WORD = { client: "Client", provider: "Provider", arbiter: "Arbiter", stranger: "Anyone" } as const;
const MODES: Array<[Mode, string]> = [
  ["auto", "Auto"],
  ["ollama", "Ollama"],
  ["gemini", "Gemini"],
  ["rules", "Rules (offline)"],
];

const NAV: Array<{ to: string; label: string; active: (p: string) => boolean }> = [
  { to: "/dashboard", label: "Dashboard", active: (p) => p === "/dashboard" },
  { to: "/vaults", label: "Vaults", active: (p) => p === "/vaults" || p.startsWith("/vault/") },
  { to: "/agreement", label: "Agreement studio", active: (p) => p === "/agreement" },
  { to: "/attack-lab", label: "Attack Lab", active: (p) => p === "/attack-lab" },
];

export function TopBar() {
  const app = useApp();
  const path = usePath();
  const [menu, setMenu] = useState(false);
  const dark = app.theme !== "light";

  // The phone menu closes when you go somewhere, and on Escape. While it is open the page behind it does not scroll.
  useEffect(() => setMenu(false), [path]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    document.body.classList.add("menu-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("menu-open");
    };
  }, [menu]);

  const sourceLabel = app.lastAi ? { ollama: "Ollama", gemini: "Gemini", rules: "Rules" }[app.lastAi.source] : null;
  const aiTitle = app.lastAi
    ? `Last answer: ${sourceLabel}${app.lastAi.model ? ` · ${app.lastAi.model}` : ""} · ${(app.lastAi.latencyMs / 1000).toFixed(1)} s`
    : "Which AI to use for extraction";

  return (
    <>
      <header className="topbar">
        <a className="brand" href="/" onClick={link("/")} aria-label="Sealstone home">
          <HashSeal hash={BRAND_HASH} state="onchain" size={28} />
          Sealstone
        </a>
        <nav className="nav desk-only" aria-label="Main">
          {NAV.map((n) => (
            <button key={n.to} aria-current={n.active(path) ? "page" : "false"} onClick={() => navigate(n.to)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <label className="pill desk-only" title={aiTitle}>
          <span className="dot amber" />
          <span className="pill-k">AI</span>
          <select aria-label="AI mode" value={app.aiMode} onChange={(e) => app.setAiMode(e.target.value as Mode)} style={{ border: 0, background: "transparent", padding: 0 }}>
            {MODES.map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </select>
          {sourceLabel && <span className="muted answered">answered: {sourceLabel}</span>}
        </label>
        <span className="pill pill-block desk-only" title="Local Hardhat chain">
          <span className="dot" style={app.chainOnline ? undefined : { background: "var(--revert)" }} />
          Block{" "}
          <span className="mono" id="block">
            {app.block ?? "—"}
          </span>
        </span>
        <div className="roles desk-only" role="group" aria-label="Acting as">
          {ACCOUNT_ROLES.map((r, i) => {
            const bal = app.balances[r];
            return (
              <button
                key={r}
                data-role={r}
                aria-pressed={app.roleIdx === i}
                onClick={() => app.setRoleIdx(i)}
                title={`${app.names[r]} · ${shortHash(accountAddress(r))}${bal !== null ? ` · ${formatWei(bal, 2)} ETH` : ""} (key ${i + 1})`}
              >
                <span className="r">{ROLE_WORD[r]}</span>
                <span className="n">{app.names[r]}</span>
              </button>
            );
          })}
        </div>
        <button className="iconbtn round desk-only" aria-pressed={app.presenter} aria-label="Presenter mode" onClick={app.togglePresenter} title="Presenter mode (P)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
        </button>
        <button className="iconbtn round desk-only" aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"} onClick={app.toggleTheme} title={`${dark ? "Light" : "Dark"} theme (T)`}>
          {dark ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
          )}
        </button>

        {/* phone: who you are acting as, and the menu button */}
        <button className="actas-chip phone-only" type="button" onClick={() => setMenu(true)} aria-label={`Acting as ${app.names[app.role]}. Open the menu to change.`}>
          <span className="r">{ROLE_WORD[app.role]}</span>
          <span className="n">{app.names[app.role]}</span>
        </button>
        <button className="menu-btn phone-only" type="button" aria-expanded={menu} aria-controls="phone-menu" aria-label="Open the menu" onClick={() => setMenu(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      </header>

      {menu && (
        <div className="phone-menu" id="phone-menu" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="pm-head">
            <a className="brand" href="/" onClick={link("/")}>
              <HashSeal hash={BRAND_HASH} state="onchain" size={28} />
              Sealstone
            </a>
            <button className="menu-btn" type="button" aria-label="Close the menu" onClick={() => setMenu(false)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div className="pm-body">
            <nav aria-label="Menu">
              {NAV.map((n) => (
                <button key={n.to} className={`pm-link${n.active(path) ? " on" : ""}`} aria-current={n.active(path) ? "page" : undefined} onClick={() => navigate(n.to)}>
                  {n.label}
                </button>
              ))}
              <button className="pm-link" onClick={() => navigate(`/vault/${deployment.preseededVault.address}`)}>Open the demo vault</button>
            </nav>

            <div className="pm-group">
              <div className="pm-label">Acting as</div>
              {ACCOUNT_ROLES.map((r, i) => {
                const bal = app.balances[r];
                return (
                  <button key={r} className={`pm-role${app.roleIdx === i ? " on" : ""}`} aria-pressed={app.roleIdx === i} onClick={() => app.setRoleIdx(i)}>
                    <span>
                      <b>{app.names[r]}</b>
                      <span className="muted small"> · {ROLE_WORD[r]}</span>
                    </span>
                    <span className="muted small mono">{bal !== null ? `${formatWei(bal, 2)} ETH` : ""}</span>
                  </button>
                );
              })}
            </div>

            <div className="pm-group">
              <label className="pm-row">
                <span>AI</span>
                <select aria-label="AI mode (menu)" value={app.aiMode} onChange={(e) => app.setAiMode(e.target.value as Mode)}>
                  {MODES.map(([m, label]) => (
                    <option key={m} value={m}>{label}</option>
                  ))}
                </select>
              </label>
              <button className="pm-row" type="button" role="switch" aria-checked={app.presenter} onClick={app.togglePresenter}>
                <span>Presenter mode</span>
                <span className={`switch${app.presenter ? " on" : ""}`} aria-hidden="true" />
              </button>
              <button className="pm-row" type="button" onClick={app.toggleTheme}>
                <span>Theme</span>
                <span className="muted">{dark ? "Dark" : "Light"}</span>
              </button>
            </div>
          </div>
          <div className="pm-foot">
            <span className="pill"><span className="dot" style={app.chainOnline ? undefined : { background: "var(--revert)" }} />Chain: block <span className="mono">{app.block ?? "—"}</span></span>
            <button className="btn go" type="button" onClick={() => navigate("/agreement")}>Draft an agreement</button>
          </div>
        </div>
      )}
    </>
  );
}
