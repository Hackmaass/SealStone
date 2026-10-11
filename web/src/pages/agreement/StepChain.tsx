import { useCallback, useEffect, useState, type Dispatch, type ReactNode } from "react";
import { navigate } from "../../lib/router";
import { useApp } from "../../lib/app";
import { explain, hasCode, signerAt, vaultContract } from "../../lib/chain";
import { deployVault } from "../../lib/deploy";
import type { DecodedRevert } from "../../lib/revert";
import type { WizardAction, WizardState } from "../../lib/wizard";
import { Amount, HashSeal, HashText, RevertNotice } from "../../ui/components";
import { formatWei } from "../../ui/copy";
import { useToast } from "../../ui/toast";

/** Runs a transaction, locks the button while pending, and turns a revert into the plain-English notice. */
function useTx(role: string) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<DecodedRevert | null>(null);
  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setBusy(label);
      setNotice(null);
      try {
        await fn();
      } catch (e) {
        const d = explain(e, role);
        if (d.reverted) {
          setNotice(d);
          toast(
            <>
              <b>{d.title}.</b> Nothing changed.
            </>,
            true,
          );
        } else {
          // A timeout or network failure may still have been mined, so never claim "Nothing changed" here.
          toast(<>That didn't complete: {d.message.slice(0, 140)}. Check the vault before trying again.</>, true);
        }
      } finally {
        setBusy(null);
      }
    },
    [role, toast],
  );
  return { busy, notice, run, setNotice };
}

export function StepChain({ state, dispatch, startOver }: { state: WizardState; dispatch: Dispatch<WizardAction>; startOver: ReactNode }) {
  const app = useApp();
  const { toast } = useToast();
  const confirmed = state.confirmed;
  const tx = useTx(app.names[app.role]);

  // ───── Step 5: deploy ─────
  if (state.step === 5 || !state.deployed) {
    if (!confirmed) {
      return (
        <div className="panel vault-note">
          <p>Confirm the terms first: only a confirmed, hashed agreement can be deployed.</p>
          <button className="btn" type="button" onClick={() => dispatch({ type: "goto", step: 4 })}>Back to Confirm</button>
        </div>
      );
    }
    const total = confirmed.checklist.milestones.reduce((s, m) => s + BigInt(m.amountWei), 0n);
    return (
      <div className="panel sealcard" style={{ maxWidth: 640, margin: "0 auto" }}>
        <HashSeal hash={confirmed.hash} state="onchain" size={132} />
        <h2>Deploy the escrow contract</h2>
        <HashText hash={confirmed.hash} />
        <p className="muted">
          {confirmed.checklist.milestones.length} milestones · <Amount wei={total} /> · review window {confirmed.checklist.reviewWindowSeconds} s. The contract starts in
          the “awaiting signatures” state: no money moves until both parties sign this exact seal.
        </p>
        {tx.notice && <RevertNotice d={tx.notice} />}
        <div className="step-actions" style={{ justifyContent: "center" }}>
          <button className="btn secondary" type="button" disabled={tx.busy !== null} onClick={() => dispatch({ type: "goto", step: 4 })}>Back</button>
          <button
            className="btn go"
            type="button"
            disabled={tx.busy !== null}
            onClick={() =>
              void tx.run("deploy", async () => {
                const signer = await signerAt(confirmed.checklist.parties.client.address);
                const r = await deployVault(confirmed.checklist, confirmed.hash, signer);
                dispatch({ type: "deployed", address: r.address, txHash: r.txHash });
                toast("Contract deployed. Waiting for both signatures.");
              })
            }
          >
            {tx.busy === "deploy" ? "Waiting for block…" : "Deploy escrow contract"}
          </button>
        </div>
      </div>
    );
  }

  return <SignAndFund state={state} dispatch={dispatch} startOver={startOver} />;
}

interface OnChain {
  exists: boolean;
  clientSigned: boolean;
  providerSigned: boolean;
  agreementState: number;
  total: bigint;
}

function SignAndFund({ state, dispatch, startOver }: { state: WizardState; dispatch: Dispatch<WizardAction>; startOver: ReactNode }) {
  const app = useApp();
  const { toast } = useToast();
  const confirmed = state.confirmed!;
  const address = state.deployed!.address;
  const tx = useTx(app.names[app.role]);
  const [chain, setChain] = useState<OnChain | null>(null);

  const refresh = useCallback(async () => {
    if (!(await hasCode(address))) return setChain({ exists: false, clientSigned: false, providerSigned: false, agreementState: 0, total: 0n });
    const v = vaultContract(address);
    const [clientSigned, providerSigned, agreementState, total] = await Promise.all([v.clientSigned(), v.providerSigned(), v.agreementState(), v.totalAmount()]);
    setChain({ exists: true, clientSigned, providerSigned, agreementState: Number(agreementState), total });
  }, [address]);
  useEffect(() => {
    void refresh();
  }, [refresh, app.block]);

  if (chain && !chain.exists) {
    return (
      <div className="panel vault-note">
        <h2>No vault at this address</h2>
        <p className="muted">The chain may have been reset since this vault was deployed. Start over to deploy a new one.</p>
        {startOver}
      </div>
    );
  }

  const parties = confirmed.checklist.parties;
  const bothSigned = !!chain && chain.clientSigned && chain.providerSigned;
  const funded = !!chain && chain.agreementState >= 2;

  const sign = (role: "client" | "provider") =>
    tx.run(`sign-${role}`, async () => {
      const signer = await signerAt(parties[role].address);
      const sent = await vaultContract(address, signer).sign(confirmed.hash);
      await sent.wait();
      dispatch({ type: "signed", role, txHash: sent.hash });
      toast(`Signed as ${role}`);
      await refresh();
    });

  const fund = () =>
    tx.run("fund", async () => {
      const signer = await signerAt(parties.client.address);
      const sent = await vaultContract(address, signer).fund({ value: chain!.total });
      await sent.wait();
      dispatch({ type: "funded", txHash: sent.hash });
      toast(`Escrow funded with ${formatWei(chain!.total)} ETH`);
      navigate(`/vault/${address}`);
    });

  const card = (role: "client" | "provider") => {
    const signed = role === "client" ? chain?.clientSigned : chain?.providerSigned;
    const hashTx = state.signatures[role];
    return (
      <div className={`panel sigcard${signed ? " signed" : ""}`} data-signature={role}>
        <h3>
          {role === "client" ? "Client" : "Provider"}: {parties[role].name}
        </h3>
        {signed ? (
          <>
            <span className="stamp-ok"><HashSeal hash={confirmed.hash} state="onchain" size={26} />Signed</span>
            {hashTx && <HashText hash={hashTx} />}
          </>
        ) : (
          <>
            <p className="muted small">Waiting for signature</p>
            <button className="btn" type="button" disabled={tx.busy !== null || funded} onClick={() => void sign(role)}>
              {tx.busy === `sign-${role}` ? "Waiting for block…" : `Sign as ${role}`}
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <div className="panel sealcard" style={{ flexDirection: "row", justifyContent: "flex-start", gap: 16, textAlign: "left" }}>
        <HashSeal hash={confirmed.hash} state="onchain" size={72} />
        <div>
          <h2>Sign and fund</h2>
          <p className="muted small">Agreement seal</p>
          <HashText hash={confirmed.hash} />
          <p className="muted small mono" style={{ marginTop: 6 }}>Contract {address}</p>
        </div>
      </div>
      <div className="sigs">
        {card("client")}
        {card("provider")}
      </div>
      {tx.notice && <RevertNotice d={tx.notice} />}
      <div className="panel sigcard">
        <h3>Fund {chain ? formatWei(chain.total) : "…"} ETH</h3>
        <p className="muted small">Locked until both parties have signed the same agreement hash.</p>
        <div>
          <button className="btn go" type="button" disabled={!bothSigned || funded || tx.busy !== null} onClick={() => void fund()} title={bothSigned ? undefined : "Both parties must sign first"}>
            {tx.busy === "fund" ? "Waiting for block…" : "Fund escrow"}
          </button>
        </div>
        {funded && (
          <button className="btn" type="button" onClick={() => navigate(`/vault/${address}`)}>Open the vault</button>
        )}
      </div>
      <div className="step-actions">{startOver}</div>
    </div>
  );
}
