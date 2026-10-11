import { useState, type Dispatch } from "react";
import { GateError, agreementHash, assertConfirmable, canonicalJSON, parseAmountWei, type GateInput, type Role } from "@mv/shared";
import { formatWei, shortHash } from "../../ui/copy";
import { api, ApiOffline, ApiRejected } from "../../lib/api";
import { useApp } from "../../lib/app";
import { ACCOUNT_ROLES, accountAddress } from "../../lib/chain";
import { rememberAgreement, type GateSummary, type WizardAction, type WizardState } from "../../lib/wizard";
import { GateBar, HashSeal, HashText } from "../../ui/components";
import { useToast } from "../../ui/toast";

const ROLES: Role[] = ["client", "provider", "arbiter"];

export function StepConfirm(props: {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  summary: GateSummary;
  reasons: string[];
  input: Omit<GateInput, "confirmedAt">;
  onBack: () => void;
  onNext: () => void;
}) {
  const { state, dispatch, reasons, input, onBack, onNext } = props;
  const app = useApp();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const edited = state.edited!;
  const proposed = state.extraction!.proposed;
  const total = edited.milestones.reduce((s, m) => s + (parseAmountWei(m.amount) ?? 0n), 0n);
  const confirmed = state.confirmed;

  async function confirm() {
    setBusy(true);
    try {
      let next: NonNullable<WizardState["confirmed"]>;
      try {
        const r = await api.confirm(input);
        if (agreementHash(r.confirmed) !== r.agreementHash) throw new Error("The server's hash does not match the confirmed terms.");
        next = { checklist: r.confirmed, hash: r.agreementHash, canonical: r.canonical, storedOnServer: true };
      } catch (e) {
        if (!(e instanceof ApiOffline)) throw e;
        // The AI service is offline: the gate is the same shared code, so confirm locally and keep the JSON in this browser.
        const checklist = assertConfirmable({ ...input, confirmedAt: new Date().toISOString() });
        next = { checklist, hash: agreementHash(checklist), canonical: canonicalJSON(checklist), storedOnServer: false };
        toast("Confirmed in this browser. The AI service is offline, so the JSON was not stored on the server.");
      }
      rememberAgreement(next.hash, next.checklist);
      app.setNames({ client: next.checklist.parties.client.name, provider: next.checklist.parties.provider.name, arbiter: next.checklist.parties.arbiter.name });
      dispatch({ type: "confirmed", confirmed: next });
      toast("Terms confirmed. Agreement seal created.");
    } catch (e) {
      const lines = e instanceof GateError || e instanceof ApiRejected ? e.errors : [(e as Error).message];
      toast(
        <>
          <b>Can't confirm yet.</b>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{lines.slice(0, 4).map((l) => <li key={l}>{l}</li>)}</ul>
        </>,
        true,
      );
    } finally {
      setBusy(false);
    }
  }

  const original = (a: string | null, b: string | null) => a !== b;

  return (
    <>
      <div className="confirm on">
        {confirmed && (
          <div className="boundary">
            <HashSeal hash={confirmed.hash} state="onchain" size={28} />
            <span>Everything above was proposed by AI and edited by people. Below are the confirmed terms. Only this exact version can be signed and deployed.</span>
          </div>
        )}
        <div className="panel terms">
          <h2>Confirmed terms</h2>
          <p className="muted small">Review the final terms, assign each party a wallet and set the review window.</p>
          <div className="party-grid">
            {ROLES.map((r) => (
              <label className="field" key={r}>
                <span>
                  {r[0].toUpperCase() + r.slice(1)}: <b>{edited.parties[r].name ?? "unnamed"}</b>
                  {original(proposed.parties[r].name, edited.parties[r].name) && (
                    <span className="edited" title={`AI proposed: ${proposed.parties[r].name ?? "no name"}`}> edited</span>
                  )}
                </span>
                <select aria-label={`Wallet for the ${r}`} value={state.addresses[r]} onChange={(e) => dispatch({ type: "address", role: r, address: e.target.value })} disabled={!!state.deployed}>
                  {ACCOUNT_ROLES.map((acc, k) => (
                    <option key={acc} value={accountAddress(acc)}>
                      Account #{k} {shortHash(accountAddress(acc))}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <label className="field" style={{ margin: "12px 0 16px", maxWidth: 520 }}>
            Review window (seconds)
            <input className="mono" type="number" min={1} aria-label="Review window in seconds" value={state.reviewWindowSeconds} onChange={(e) => dispatch({ type: "window", seconds: Math.floor(Number(e.target.value)) })} style={{ maxWidth: 160 }} />
            <span className="muted small">The client has this long to respond before the provider may escalate to the arbiter. Demo default: 2 minutes.</span>
          </label>
          <table>
            <thead>
              <tr><th>#</th><th>Milestone</th><th>Condition</th><th>Due</th><th style={{ textAlign: "right" }}>Amount</th></tr>
            </thead>
            <tbody>
              {edited.milestones.map((m, i) => {
                const p = proposed.milestones[i];
                const amountEdited = p ? original(p.amount, m.amount) : true;
                const dueEdited = p ? original(p.deadline, m.deadline) : true;
                const condEdited = p ? p.conditions.map((c) => c.text).join("|") !== m.conditions.map((c) => c.text).join("|") : true;
                return (
                  <tr key={i}>
                    <td className="mono">{i + 1}</td>
                    <td>{m.title}</td>
                    <td>
                      {condEdited ? (
                        <span className="edited" title={`AI proposed: ${p ? p.conditions.map((c) => c.text).join("; ") : "nothing"}`}>
                          {m.conditions.map((c) => c.text).join("; ")}
                        </span>
                      ) : (
                        m.conditions.map((c) => c.text).join("; ")
                      )}
                    </td>
                    <td>
                      {dueEdited ? <span className="edited" title={`AI proposed: ${p?.deadline ?? "no date"}`}>{m.deadline ?? "No deadline"}</span> : m.deadline ?? "No deadline"}
                    </td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      {amountEdited ? <span className="edited" title={`AI proposed: ${p?.amount ?? "no amount"}`}>{formatWei(parseAmountWei(m.amount) ?? 0n)} ETH</span> : `${formatWei(parseAmountWei(m.amount) ?? 0n)} ETH`}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td />
                <td colSpan={3}><b>Total</b></td>
                <td className="mono" style={{ textAlign: "right" }}><b>{formatWei(total)} ETH</b></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="panel sealcard">
          {confirmed ? (
            <>
              <HashSeal hash={confirmed.hash} state="onchain" size={132} draw />
              <h3>Agreement seal</h3>
              <HashText hash={confirmed.hash} />
              <p className="muted small">Change one character in the terms and this seal changes. Both parties sign this exact seal before any money moves.</p>
              {!confirmed.storedOnServer && <p className="status-note open">Kept in this browser only: the AI service was offline.</p>}
              <details style={{ width: "100%", textAlign: "left" }}>
                <summary>Canonical JSON that was hashed</summary>
                <pre className="json">{confirmed.canonical}</pre>
              </details>
              <button className="btn" type="button" onClick={onNext}>Deploy and continue</button>
            </>
          ) : (
            <>
              <h3>Agreement seal</h3>
              <p className="muted small">The seal appears when you confirm. It is the fingerprint of the exact terms on the left.</p>
            </>
          )}
        </div>
      </div>
      {confirmed ? (
        <div className="step-actions">
          <button className="btn secondary" type="button" onClick={onBack}>Back to the issues</button>
          <span className="muted small">Any change to the terms, wallets or review window clears this seal.</span>
        </div>
      ) : (
        <GateBar reasons={reasons} passes={reasons.length === 0 ? [`Every issue is resolved and re-checked. The terms add up to ${formatWei(total)} ETH.`, "Wallets assigned to client, provider and arbiter."] : []} label="Confirm terms" busy={busy} onClick={() => void confirm()} />
      )}
      {!confirmed && (
        <div className="step-actions"><button className="btn secondary" type="button" onClick={onBack}>Back to the issues</button></div>
      )}
    </>
  );
}
