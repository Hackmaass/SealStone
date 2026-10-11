import { useRef } from "react";
import { NET } from "../../lib/network";
import { Amount, HashSeal, HashText, RevertNotice, StateBadge, StateTrack } from "../../ui/components";
import { shortHash } from "../../ui/copy";
import type { DecodedRevert } from "../../lib/revert";
import { planFor, type ActionId, type MilestoneView, type VaultRole } from "../../lib/vaultModel";
import { BriefPanel } from "./EvidencePanels";
import { useNote } from "./Sheets";

const isZero = (h: string): boolean => /^0x0*$/.test(h);

export interface RowTerms {
  title: string;
  conditions: string[];
  deadline: string | null;
}

export interface RowProps {
  m: MilestoneView;
  terms: RowTerms | null;
  role: VaultRole;
  agreementState: number;
  nextMilestone: number;
  reviewWindow: bigint;
  chainNow: bigint;
  names: { client: string; provider: string; arbiter: string };
  busy: string | null;
  reject: DecodedRevert | null;
  shake: boolean;
  onShakeEnd: () => void;
  onOffer: (id: ActionId) => void;
  onTry: (id: ActionId) => void;
  onSkipTime: (seconds: bigint) => void;
}

function NoteLine({ hash, heading, emptyText }: { hash: string; heading: string; emptyText?: string }) {
  const note = useNote(hash);
  if (isZero(hash)) return emptyText ? <p className="muted small note-line">{emptyText}</p> : null;
  return (
    <div className="note-line">
      <HashSeal hash={hash} state="onchain" size={28} />
      <div>
        <b>{heading}</b>{" "}
        {note === "loading" ? (
          <span className="muted small">reading…</span>
        ) : note ? (
          <q>{note}</q>
        ) : (
          <span className="muted small">The text isn't stored in this browser; only its seal is on the chain.</span>
        )}
        <div><HashText hash={hash} /></div>
      </div>
    </div>
  );
}

export function MilestoneRow(p: RowProps) {
  const { m } = p;
  const plan = planFor({ role: p.role, agreementState: p.agreementState, nextMilestone: p.nextMilestone, milestone: m, reviewWindow: p.reviewWindow, chainNow: p.chainNow });
  const locked = m.state === "Pending" && m.index > p.nextMilestone && p.agreementState === 2;
  const settled = m.state === "Released" || m.state === "Refunded";
  const resolvedByArbiter = !isZero(m.rationaleHash);
  const escalated = isZero(m.evidenceHash) && (m.state === "Disputed" || resolvedByArbiter);
  const tryMenu = useRef<HTMLDetailsElement>(null);
  const timeLeft = m.state === "Completed" ? m.completedAt + p.reviewWindow - p.chainNow : 0n;
  const closeMenu = () => tryMenu.current?.removeAttribute("open");
  const mismatch = p.reject?.name === "DeliverableHashMismatch" ? p.reject : null;

  return (
    <div
      className={`ms-row${locked ? " locked" : ""}${p.shake ? " shake" : ""}`}
      id={`ms-${m.index}`}
      data-milestone={m.index}
      data-state={m.state}
      onAnimationEnd={p.onShakeEnd}
    >
      <div className="num">{m.index + 1}</div>
      <div className="body">
        <div className="ms-title">
          <h3>{p.terms?.title ?? `Milestone ${m.index + 1}`}</h3>
          <StateBadge state={m.state} />
          {p.terms?.deadline && <span className="muted small">Due {p.terms.deadline}</span>}
        </div>

        <StateTrack state={m.state} disputed={resolvedByArbiter} />

        {p.terms && p.terms.conditions.length > 0 && (
          <details className="conditions" open={p.role === "arbiter" && m.state === "Disputed"}>
            <summary>What was agreed ({p.terms.conditions.length} conditions)</summary>
            <ul>
              {p.terms.conditions.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </details>
        )}

        {!isZero(m.deliverableHash) && (
          <div className="facts">
            <span className="f">
              <HashSeal hash={m.deliverableHash} state={m.state === "Released" ? "onchain" : "submitted"} size={28} />
              Submitted file <HashText hash={m.deliverableHash} />
            </span>
          </div>
        )}
        {(m.state === "Disputed" || resolvedByArbiter || !isZero(m.evidenceHash)) && (
          <NoteLine
            hash={m.evidenceHash}
            heading="Client's reason:"
            emptyText={escalated ? "Escalated by the provider after the review window. The client gave no reason." : undefined}
          />
        )}
        {resolvedByArbiter && <NoteLine hash={m.rationaleHash} heading="Arbiter's reasoning:" />}
        {p.role === "arbiter" && m.state === "Disputed" && p.terms && p.terms.conditions.length > 0 && <BriefPanel conditions={p.terms.conditions} evidenceHash={m.evidenceHash} />}

        {p.reject && (
          <>
            <RevertNotice d={p.reject} />
            {mismatch && (
              <div className="compare mini" aria-label="The two seals">
                <div className="side">
                  <HashSeal hash={String(mismatch.args.expected)} state="submitted" size={56} />
                  <span>Submitted</span>
                  <span className="mono small">{shortHash(String(mismatch.args.expected))}</span>
                </div>
                <div className="verdict bad">Different files</div>
                <div className="side">
                  <HashSeal hash={String(mismatch.args.provided)} state="mismatch" size={56} />
                  <span>Yours</span>
                  <span className="mono small">{shortHash(String(mismatch.args.provided))}</span>
                </div>
              </div>
            )}
          </>
        )}

        {!settled && plan.waitingText && (
          <p className="waiting" data-testid={`waiting-${m.index}`}>
            {plan.waitingFor ? (
              <>
                Waiting for: <b>{p.names[plan.waitingFor as "client" | "provider" | "arbiter"]}</b>.{" "}
                <span className="muted">{plan.waitingText.replace(/^Waiting for [^.]*\.\s?/, "")}</span>
              </>
            ) : (
              <span className="muted">{plan.waitingText}</span>
            )}
          </p>
        )}

        {!settled && (plan.offers.length > 0 || plan.tryAnyway.length > 0) && (
          <div className="actions">
            {plan.offers.map((o, i) =>
              o.disabledReason ? (
                <span key={o.id} className="act-disabled">
                  <button className="btn secondary" type="button" disabled aria-describedby={`why-${m.index}-${o.id}`}>
                    {o.label}
                  </button>
                  <span className="muted small" id={`why-${m.index}-${o.id}`}>{o.disabledReason}</span>
                </span>
              ) : (
                <button
                  key={o.id}
                  type="button"
                  data-action={o.id}
                  className={i === 0 ? (o.id === "approve" || o.id === "release" ? "btn go" : "btn") : "btn secondary"}
                  disabled={p.busy !== null}
                  onClick={() => p.onOffer(o.id)}
                >
                  {p.busy?.endsWith(`:${m.index}`) && p.busy.startsWith(o.id) ? "Waiting for block…" : o.label}
                </button>
              ),
            )}
            {plan.tryAnyway.length > 0 && (
              <details className="try" ref={tryMenu}>
                <summary>Try anyway</summary>
                <div className="menu">
                  {plan.tryAnyway.map((t) => (
                    <button
                      key={t.id + t.label}
                      type="button"
                      data-try={t.id}
                      disabled={p.busy !== null}
                      onClick={() => {
                        closeMenu();
                        p.onTry(t.id);
                      }}
                    >
                      {t.label}
                      <small>{t.why}</small>
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {timeLeft > 0n && NET === "local" && (
          <div className="time-control">
            <button type="button" className="linklike" disabled={p.busy !== null} onClick={() => p.onSkipTime(timeLeft + 1n)}>
              Demo control: skip the review window
            </button>
            <span className="muted small">Moves the local test chain's clock forward. It cannot exist on a real network.</span>
          </div>
        )}
      </div>
      <div className="amt"><Amount wei={m.amount} /></div>
    </div>
  );
}
