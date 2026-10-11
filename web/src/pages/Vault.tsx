import { useEffect, useState } from "react";
import { hasCode, vaultContract } from "../lib/chain";
import { Amount } from "../ui/components";

/** Placeholder until P08 builds the full vault screen (milestones, ledger, activity). */
export function VaultPage({ address }: { address: string }) {
  const [state, setState] = useState<{ exists: boolean; ok?: boolean; deposited?: bigint } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!(await hasCode(address))) return alive && setState({ exists: false });
      const r = await vaultContract(address).reconcile();
      if (alive) setState({ exists: true, ok: r.ok as boolean, deposited: r.deposited as bigint });
    })();
    return () => {
      alive = false;
    };
  }, [address]);

  return (
    <div className="panel vault-note">
      <h1>Vault</h1>
      <p className="mono small muted">{address}</p>
      {state === null && <p className="muted">Reading the chain…</p>}
      {state?.exists === false && <p>No vault at this address. The chain may have been reset. Draft a new agreement or open the demo vault.</p>}
      {state?.exists && (
        <p>
          Reconciled: <b>{state.ok ? "yes" : "NO"}</b> · Deposited <Amount wei={state.deposited ?? 0n} />
        </p>
      )}
    </div>
  );
}
