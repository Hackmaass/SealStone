import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/app";
import { accountAddress } from "../lib/chain";
import { MST, explorerAddress } from "../lib/mstNetwork";
import { UNIT } from "../lib/units";
import { onMst, switchWalletToMst, useWalletState } from "../lib/wallet";
import { formatWei, shortHash } from "./copy";
import { useOnboarding } from "./Onboarding";

const ROLE_WORD = { client: "Client", provider: "Provider", arbiter: "Arbiter", stranger: "Anyone" } as const;

/**
 * The connected wallet in the top bar. Local mode: the chosen test account. Wallet mode: the real wallet's address, balance and
 * network, with a switch-network button if it is on the wrong one. Both: replay the tour, disconnect.
 */
export function WalletMenu() {
  const app = useApp();
  const ws = useWalletState();
  const { startTour, disconnect } = useOnboarding();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const wallet = app.net === "wallet";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // wallet mode without a wallet: the button is the way in
  if (wallet && !app.walletAccount) {
    return (
      <div className="wmenu" data-tour="wallet">
        <button className="btn go" type="button" onClick={disconnect} data-testid="wallet-connect-top">Connect wallet</button>
      </div>
    );
  }

  const address = wallet ? app.walletAccount! : accountAddress(app.role);
  const bal = wallet ? app.walletBalance : app.balances[app.role];
  const unit = wallet ? UNIT : "ETH";

  return (
    <div className="wmenu" ref={box} data-tour="wallet">
      <button className="pill wbtn" type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} data-testid="wallet-button" title={wallet ? `${ws.wallet?.name ?? "Wallet"} on ${MST.name}` : "Your demo wallet"}>
        <span className="dot" style={wallet && !onMst(ws) ? { background: "var(--revert)" } : undefined} />
        <span className="mono">{shortHash(address)}</span>
      </button>
      {open && (
        <div className="wpop" role="group" aria-label={wallet ? "Wallet" : "Demo wallet"}>
          <div className="wpop-head">
            <b>{wallet ? (ws.wallet?.name ?? "Browser wallet") : "Sealstone demo wallet"}</b>
            <span className="muted small">{wallet ? `Every transaction opens your wallet to confirm.` : "A test account on your local chain. No real money."}</span>
          </div>
          <div className="wpop-acct">
            <span>{wallet ? <b>Account</b> : <><b>{ROLE_WORD[app.role]}</b><span className="muted small"> · {app.names[app.role]}</span></>}</span>
            <span className="mono small muted">{bal !== null ? `${formatWei(bal, 3)} ${unit}` : "—"}</span>
          </div>
          <div className="wpop-addr mono small muted">{address}</div>
          {wallet && (
            <>
              <div className="wpop-net">
                <span>{onMst(ws) ? `${MST.name} ✓` : "Another network"}</span>
                <a href={explorerAddress(address)} target="_blank" rel="noreferrer">Explorer</a>
                <a href={MST.faucet} target="_blank" rel="noreferrer">Faucet</a>
              </div>
              {!onMst(ws) && (
                <>
                  <p className="wpop-warn">Your wallet isn't on {MST.name}, so transactions will be refused.</p>
                  <button className="wpop-row" type="button" onClick={() => void switchWalletToMst().catch(() => undefined)}>Switch to {MST.name}</button>
                </>
              )}
            </>
          )}
          <button className="wpop-row" type="button" onClick={() => { setOpen(false); startTour(); }} data-testid="wallet-tour">
            Take the tour <kbd>?</kbd>
          </button>
          <button className="wpop-row" type="button" onClick={() => { setOpen(false); disconnect(); }} data-testid="wallet-disconnect">
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
