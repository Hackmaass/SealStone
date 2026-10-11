import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/app";
import { ACCOUNT_ROLES, accountAddress, provider } from "../lib/chain";
import { intentLabel } from "../lib/onboarding";
import { isHosted } from "../lib/hosted";
import { MST } from "../lib/mstNetwork";
import { NET } from "../lib/network";
import { usePath } from "../lib/router";
import { connectWallet, rescanWallets, useWalletState, useWallets, type WalletInfo } from "../lib/wallet";
import { BrandMark } from "./BrandMark";
import { formatWei, shortHash } from "./copy";
import { HashSeal } from "./components";
import deployment from "../generated/deployment.json";

const ROLE_WORD = { client: "Client", provider: "Provider", arbiter: "Arbiter", stranger: "Anyone" } as const;
const ROLE_BLURB = { client: "Funds the vault, approves work", provider: "Does the work, submits the file", arbiter: "Settles disputes", stranger: "Can look, can't touch the money" } as const;

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("timeout")), ms);
  p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
});

/** What the person chose on this screen. */
export type GateChoice = { kind: "demo"; roleIdx: number } | { kind: "wallet" } | { kind: "viewer" };

type Phase = "idle" | "connecting" | "connected";

/**
 * The first screen of the app.
 *  - "Sealstone demo wallet": choose which of the local chain's four test accounts you start as. Local only; works offline; no
 *    browser extension is touched.
 *  - "Browser wallet": a real wallet (MetaMask, BridgeKey, ...) on MST testnet. Its own pop-up opens to connect, to switch or add
 *    the network, and to confirm every transaction. The pop-up only ever opens from a click on a wallet's Connect button.
 * It never blocks: with the chain down, or on a hosted copy, you can still look around.
 */
export function WalletGate({ onConnect }: { onConnect: (choice: GateChoice, opts: { skipTour: boolean }) => void }) {
  const app = useApp();
  const path = usePath();
  const wallets = useWallets();
  const ws = useWalletState();
  const [pick, setPick] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [reach, setReach] = useState<{ ok: boolean; block?: number } | null>(null);
  const [walletBusy, setWalletBusy] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  // hosted copies have no local chain: the wallet is the only way to act, and read-only is the way to look
  const walletOnly = isHosted;

  useEffect(() => {
    if (!walletOnly) first.current?.focus({ preventScroll: true });
  }, [walletOnly]);

  const demoConnect = async (skipTour = false, idx = pick) => {
    if (phase !== "idle" || walletOnly) return;
    setPhase("connecting");
    try {
      setReach({ ok: true, block: await withTimeout(provider.getBlockNumber(), 1500) });
    } catch {
      setReach({ ok: false });
    }
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    await new Promise((r) => setTimeout(r, reduce ? 0 : 750));
    setPhase("connected");
    await new Promise((r) => setTimeout(r, reduce ? 0 : 650));
    onConnect({ kind: "demo", roleIdx: idx }, { skipTour });
  };

  /** The one place a wallet pop-up is opened: a click on a wallet's Connect button. */
  const walletConnect = async (w: WalletInfo) => {
    if (walletBusy) return;
    setWalletBusy(w.id);
    try {
      await connectWallet(w);
      setPhase("connected");
      await new Promise((r) => setTimeout(r, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500));
      onConnect({ kind: "wallet" }, { skipTour: false });
    } catch {
      /* the reason is in the wallet state and shown below */
    } finally {
      setWalletBusy(null);
    }
  };

  // Escape is "skip": the demo wallet as the client (local), or look around read-only (hosted). No tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || walletBusy) return;
      if (walletOnly) onConnect({ kind: "viewer" }, { skipTour: true });
      else void demoConnect(true, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const where = intentLabel(path);
  const busy = phase !== "idle" || walletBusy !== null;
  const localChainDown = !walletOnly && !app.chainOnline;

  const walletCard = (
    <div className={`og-opt${walletOnly ? " on" : ""}`} data-testid="wallet-card">
      <div className="og-opt-head">
        <span className="og-ico" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></svg>
        </span>
        <div>
          <b>Browser wallet · {MST.name}</b>
          <span className="og-sub">
            Connect MetaMask, BridgeKey or another wallet. Your wallet opens to connect, to switch to {MST.name} (chainId {MST.chainId}) and to confirm every transaction. Test coins only ({MST.symbol}): get some from the{" "}
            <a href={MST.faucet} target="_blank" rel="noreferrer">faucet</a>.
          </span>
        </div>
        <span className={`og-badge${walletOnly ? "" : " quiet"}`}>{walletOnly ? "Required to act" : "Real pop-ups"}</span>
      </div>
      <div className="og-wallets" role="group" aria-label="Detected wallets">
        {wallets.map((w) => (
          <div className="og-wallet" key={w.id} data-testid="wallet-row">
            {w.icon ? <img src={w.icon} alt="" width="28" height="28" /> : <span className="og-wicon" aria-hidden="true" />}
            <span className="og-wname">{w.name}</span>
            <button className={`btn${walletOnly ? " go" : " secondary"}`} type="button" disabled={busy} onClick={() => void walletConnect(w)} data-testid="wallet-connect">
              {walletBusy === w.id || ws.status === "connecting" ? <><span className="og-spin" aria-hidden="true" />Check your wallet…</> : `Connect ${w.name}`}
            </button>
          </div>
        ))}
        {wallets.length === 0 && (
          <p className="og-sub" data-testid="no-wallet">
            No wallet found. Install BridgeKey or MetaMask, allow it on this site, then press Rescan.{" "}
            <button className="linklike" type="button" onClick={rescanWallets}>Rescan</button>
          </p>
        )}
      </div>
      {ws.error && <p className="og-note" role="alert" data-testid="wallet-error">{ws.error}</p>}
    </div>
  );

  return (
    <div className="og" role="dialog" aria-modal="true" aria-labelledby="og-title" data-testid="wallet-gate" data-phase={phase} data-net={NET}>
      <aside className="og-story">
        <div className="og-brand">
          <BrandMark size={30} />
          Sealstone
        </div>
        <div className="og-seal" aria-hidden="true">
          <HashSeal hash={deployment.preseededVault.agreementHash} state="onchain" size={190} draw />
        </div>
        <h2 className="og-tag">Escrow that can't be tricked.</h2>
        <ul className="og-points">
          <li style={{ ["--i" as string]: 0 }}><b>Agreements,</b> checked before money locks</li>
          <li style={{ ["--i" as string]: 1 }}><b>Files,</b> approved only if they match exactly</li>
          <li style={{ ["--i" as string]: 2 }}><b>Funds,</b> on books that always reconcile</li>
        </ul>
        <p className="og-fine">Test money only: {walletOnly ? `${MST.name} coins have no real value.` : "nothing here touches a public network unless you connect a browser wallet."}</p>
      </aside>

      <section className="og-card">
        <ol className="og-steps" aria-label="Getting started">
          <li className="now"><span>1</span>Connect</li>
          <li><span>2</span>Take the tour</li>
          <li><span>3</span>Start</li>
        </ol>

        <h1 id="og-title">Connect a wallet</h1>
        <p className="og-lede">{walletOnly ? `Connect your wallet to act on ${MST.name}. You'll continue to ${where}.` : `Pick how you want to connect. You'll continue to ${where}.`}</p>

        {walletOnly && walletCard}

        {!walletOnly && (
          <div className="og-opt on">
            <div className="og-opt-head">
              <span className="og-ico" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12.5h2.5M3 10h18M7 6V5a2 2 0 0 1 2-2h8" /></svg>
              </span>
              <div>
                <b>Sealstone demo wallet</b>
                <span className="og-sub">Four test accounts on your local chain. Works offline, no extension.</span>
              </div>
              <span className="og-badge">Recommended</span>
            </div>
            <div className="og-accts" role="radiogroup" aria-label="Choose an account">
              {ACCOUNT_ROLES.map((r, i) => {
                const bal = app.balances[r];
                return (
                  <label key={r} className={`og-acct${pick === i ? " sel" : ""}`} data-role={r}>
                    <input ref={i === 0 ? first : undefined} type="radio" name="og-acct" checked={pick === i} onChange={() => setPick(i)} disabled={busy} />
                    <span className="og-acct-t">
                      <b>{ROLE_WORD[r]}</b>
                      <span className="muted small">{app.names[r]} · {ROLE_BLURB[r]}</span>
                    </span>
                    <span className="og-acct-n mono">
                      <span>{shortHash(accountAddress(r))}</span>
                      <span className="muted">{bal !== null ? `${formatWei(bal, 2)} ETH` : "—"}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {!walletOnly && walletCard}

        {localChainDown && (
          <p className="og-note" role="status" data-testid="gate-offline">
            The local chain isn't reachable yet. Start it with npm run dev. You can continue and look around meanwhile.
          </p>
        )}
        {reach?.ok && phase !== "idle" && <p className="og-note ok" role="status">Connected to the local chain at block {reach.block}.</p>}
        {phase === "connected" && walletOnly && <p className="og-note ok" role="status">Wallet connected.</p>}

        <div className="og-actions">
          {!walletOnly && (
            <button className="btn go og-go" type="button" onClick={() => void demoConnect(false)} disabled={busy} data-testid="gate-connect">
              {phase === "idle" && <>Connect demo wallet and continue</>}
              {phase === "connecting" && <><span className="og-spin" aria-hidden="true" />Opening your demo wallet…</>}
              {phase === "connected" && <><svg className="og-tick" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>Connected</>}
            </button>
          )}
          {walletOnly ? (
            <button className="linklike og-skip" type="button" onClick={() => onConnect({ kind: "viewer" }, { skipTour: true })} disabled={busy} data-testid="gate-skip">
              Look around without a wallet <kbd>Esc</kbd>
            </button>
          ) : (
            <button className="linklike og-skip" type="button" onClick={() => void demoConnect(true, 0)} disabled={busy} data-testid="gate-skip">
              Skip setup <kbd>Esc</kbd>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
