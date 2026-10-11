import { useState } from "react";
import { hasCode, vaultContract } from "../lib/chain";
import { MST } from "../lib/mstNetwork";
import { parseVaultAddress, rememberVault } from "../lib/registry";
import { navigate } from "../lib/router";

/**
 * Wallet mode keeps no chain-wide registry (a public testnet is not scanned), so a vault made elsewhere, or by someone else, is
 * opened by its address. It must be a real Sealstone vault on MST testnet: it is checked before it is remembered.
 */
export function OpenVault({ compact = false }: { compact?: boolean }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    const address = parseVaultAddress(text);
    if (!address) return setMsg("That isn't a wallet or contract address (0x followed by 40 characters).");
    setBusy(true);
    setMsg(null);
    try {
      if (!(await hasCode(address))) return setMsg(`There is no contract at that address on ${MST.name}.`);
      await vaultContract(address).agreementHash();
      rememberVault(address);
      setText("");
      navigate(`/vault/${address}`);
    } catch {
      setMsg("That contract isn't a Sealstone vault (or the chain didn't answer). Check the address and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="vault-open" onSubmit={(e) => { e.preventDefault(); void open(); }} data-testid="open-vault">
      <input className="mono" aria-label="Vault address" placeholder="Open a vault by address: 0x…" spellCheck={false} autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
      <button className={compact ? "btn secondary" : "btn go"} type="submit" disabled={busy || text.trim() === ""}>{busy ? "Checking…" : "Open"}</button>
      {msg && <span className="small" role="alert" style={{ flexBasis: "100%", color: "var(--revert)" }}>{msg}</span>}
    </form>
  );
}
