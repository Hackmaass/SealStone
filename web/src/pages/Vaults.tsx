import { useMemo, useState } from "react";
import { deployment } from "../lib/chain";
import { NET } from "../lib/network";
import { OpenVault } from "../ui/OpenVault";
import { navigate } from "../lib/router";
import { useVaultList } from "../lib/useVaultList";
import { AGREEMENT_NAMES } from "../lib/vaultModel";
import { VaultTable, VaultTableSkeleton, vaultName } from "../ui/VaultTable";

/** Every agreement on this chain, searchable and filterable by status (the list view of the app). */
export function Vaults() {
  const { state } = useVaultList();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<number | "all">("all");
  const list = state.status === "ready" ? state.list : [];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter((v) => (status === "all" || v.agreementState === status) && (needle === "" || vaultName(v).toLowerCase().includes(needle) || v.address.toLowerCase().includes(needle)));
  }, [list, q, status]);

  return (
    <div className="vaults-page">
      <div className="pagehead">
        <div>
          <h1>Vaults</h1>
          <p className="muted lede">Every escrow agreement on this chain. Each one is a contract whose books you can check yourself.</p>
        </div>
        <button className="btn go" type="button" onClick={() => navigate("/agreement")}>Draft an agreement</button>
      </div>
      {NET === "wallet" && <OpenVault />}

      <div className="filters">
        <label className="search">
          <span className="sr-only">Search agreements</span>
          <input type="search" placeholder="Search by name or address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search agreements" />
        </label>
        <label className="select">
          <span className="sr-only">Filter by status</span>
          <select aria-label="Filter by status" value={String(status)} onChange={(e) => setStatus(e.target.value === "all" ? "all" : Number(e.target.value))}>
            <option value="all">All statuses</option>
            {AGREEMENT_NAMES.map((n, i) => (
              <option key={n} value={i}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      <section className="panel dash-card" aria-label="Vault list">
        {state.status === "loading" && <VaultTableSkeleton />}
        {state.status === "error" && <p className="empty" role="alert">Couldn't read the chain: {state.message}. Is it running? <code>npm run chain</code></p>}
        {state.status === "ready" && (
          <VaultTable
            list={shown}
            empty={
              list.length === 0 ? (
                <div className="empty">
                  <p>No agreements yet.</p>
                  <p className="muted small">Draft one from text, or open the demo vault.</p>
                  <div className="actions" style={{ marginTop: 10 }}>
                    <button className="btn go" type="button" onClick={() => navigate("/agreement")}>Draft an agreement</button>
                    {NET === "local" && <button className="btn secondary" type="button" onClick={() => navigate(`/vault/${deployment.preseededVault.address}`)}>Open the demo vault</button>}
                  </div>
                </div>
              ) : (
                <div className="empty"><p>No agreement matches that search.</p></div>
              )
            }
          />
        )}
      </section>
    </div>
  );
}
