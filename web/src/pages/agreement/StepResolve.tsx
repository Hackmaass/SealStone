import { useMemo, useState, type Dispatch } from "react";
import { parseAmountWei, type Ambiguity, type ProposedChecklist, type Resolution, type Role } from "@mv/shared";
import { fixesFor, gateReasons, type Edit, type GateSummary, type WizardAction, type WizardState } from "../../lib/wizard";
import { GateBar } from "../../ui/components";
import { DocView } from "./DocView";

const TYPE_LABEL: Record<Ambiguity["type"], string> = {
  MISSING_PARTY: "Missing party",
  PARTY_CONFLICT: "Party conflict",
  MISSING_AMOUNT: "Missing amount",
  AMOUNT_MISMATCH: "Total doesn't add up",
  CONDITIONAL_AMOUNT: "Conditional amount",
  AMOUNT_NOT_IN_TEXT: "Amount not in the text",
  VAGUE_CONDITION: "Vague condition",
  SUBJECTIVE_APPROVAL: "Subjective approval",
  MISSING_DEADLINE: "Missing deadline",
  UNDEFINED_TRANSITION: "Undefined transition",
  CURRENCY_UNCLEAR: "Currency unclear",
};

const ACTION_LABEL: Record<Resolution["action"], string> = { edited: "Edited", acknowledged: "Acknowledged", "clause-removed": "Clause removed" };

// ───────────────────────────── Editors for the affected field ─────────────────────────────

function ConditionsEditor({ i, edited, dispatch }: { i: number; edited: ProposedChecklist; dispatch: Dispatch<WizardAction> }) {
  const edit = (edits: Edit[]) => dispatch({ type: "edit", edits });
  const m = edited.milestones[i];
  return (
    <div className="stack-gap" style={{ gap: 6 }}>
      <span className="small muted">Conditions for milestone {i + 1}</span>
      {m.conditions.map((c, j) => (
        <div className="cond-row" key={j}>
          <input aria-label={`Condition ${j + 1} of milestone ${i + 1}`} value={c.text} onChange={(e) => edit([{ type: "condition", i, j, text: e.target.value }])} />
          <button className="btn secondary" type="button" onClick={() => edit([{ type: "removeCondition", i, j }])} aria-label={`Remove condition ${j + 1}`}>
            Remove
          </button>
        </div>
      ))}
      <button className="btn secondary" type="button" style={{ alignSelf: "flex-start" }} onClick={() => edit([{ type: "addCondition", i, text: "" }])}>
        Add a condition
      </button>
    </div>
  );
}

function AmountField({ i, edited, dispatch }: { i: number; edited: ProposedChecklist; dispatch: Dispatch<WizardAction> }) {
  const m = edited.milestones[i];
  const bad = m.amount !== null && parseAmountWei(m.amount) === null;
  return (
    <label className="field">
      Amount for milestone {i + 1} (ETH)
      <input
        className="mono"
        inputMode="decimal"
        aria-label={`Amount for milestone ${i + 1} in ETH`}
        value={m.amount ?? ""}
        placeholder="e.g. 1.5"
        onChange={(e) => dispatch({ type: "edit", edits: [{ type: "amount", i, value: e.target.value }] })}
        aria-invalid={bad}
      />
    </label>
  );
}

function FieldEditor({ a, edited, dispatch }: { a: Ambiguity; edited: ProposedChecklist; dispatch: Dispatch<WizardAction> }) {
  const i = a.milestoneIndex;
  switch (a.type) {
    case "MISSING_PARTY":
    case "PARTY_CONFLICT":
      return (
        <div className="stack-gap" style={{ gap: 6 }}>
          {(["client", "provider", "arbiter"] as Role[]).map((r) => (
            <label className="field" key={r}>
              Name of the {r}
              <input aria-label={`Name of the ${r}`} value={edited.parties[r].name ?? ""} onChange={(e) => dispatch({ type: "edit", edits: [{ type: "party", role: r, name: e.target.value }] })} />
            </label>
          ))}
        </div>
      );
    case "MISSING_AMOUNT":
    case "CONDITIONAL_AMOUNT":
    case "AMOUNT_NOT_IN_TEXT":
      return i === null ? null : (
        <div className="stack-gap" style={{ gap: 8 }}>
          <AmountField i={i} edited={edited} dispatch={dispatch} />
          <ConditionsEditor i={i} edited={edited} dispatch={dispatch} />
        </div>
      );
    case "AMOUNT_MISMATCH":
      return (
        <div className="stack-gap" style={{ gap: 8 }}>
          <label className="field">
            Stated total (ETH)
            <input className="mono" aria-label="Stated total in ETH" value={edited.totalStated ?? ""} onChange={(e) => dispatch({ type: "edit", edits: [{ type: "total", value: e.target.value }] })} />
          </label>
          {edited.milestones.map((_, k) => (
            <AmountField key={k} i={k} edited={edited} dispatch={dispatch} />
          ))}
        </div>
      );
    case "VAGUE_CONDITION":
    case "SUBJECTIVE_APPROVAL":
    case "UNDEFINED_TRANSITION":
      return i === null ? null : <ConditionsEditor i={i} edited={edited} dispatch={dispatch} />;
    case "MISSING_DEADLINE":
      return i === null ? null : (
        <label className="field">
          Deadline for milestone {i + 1}
          <input type="date" aria-label={`Deadline for milestone ${i + 1}`} value={edited.milestones[i].deadline ?? ""} onChange={(e) => dispatch({ type: "edit", edits: [{ type: "deadline", i, value: e.target.value }] })} />
        </label>
      );
    default:
      return null;
  }
}

// ───────────────────────────── One ambiguity card ─────────────────────────────

function AmbiguityCard(props: {
  a: Ambiguity;
  n: number;
  edited: ProposedChecklist;
  resolution?: Resolution;
  stillFlagged: boolean;
  resolvedBy: "client" | "provider";
  dispatch: Dispatch<WizardAction>;
  onHover: (id: string | null) => void;
}) {
  const { a, n, edited, resolution, stillFlagged, resolvedBy, dispatch, onHover } = props;
  const [action, setAction] = useState<Resolution["action"]>("edited");
  const [note, setNote] = useState("");
  const blocking = a.severity === "blocking";
  const fixes = useMemo(() => fixesFor(a, edited), [a, edited]);
  const resolve = (act: Resolution["action"], text: string) => dispatch({ type: "resolve", resolution: { ambiguityId: a.id, action: act, note: text, resolvedBy } });
  const noteOk = note.trim().length >= 5;
  const cannotAck = blocking && action === "acknowledged";

  return (
    <div className={`amb-card ${resolution ? "res" : ""}`} id={`card-${a.id}`} onMouseEnter={() => onHover(a.id)} onMouseLeave={() => onHover(null)} data-ambiguity={a.id}>
      <div className="top">
        <span className="t">
          <span className="n">{n}</span>
          {TYPE_LABEL[a.type]}
        </span>
        <span className={`chip ${resolution ? "human" : blocking ? "revert" : "pending"}`}>{resolution ? "Resolved" : blocking ? "Blocking" : "Warning"}</span>
      </div>
      {a.quote && <blockquote>“{a.quote}”</blockquote>}
      {resolution ? (
        <p className="done">
          {ACTION_LABEL[resolution.action]}: <span className="muted">{resolution.note}</span>{" "}
          <button className="fix" type="button" onClick={() => dispatch({ type: "unresolve", id: a.id })}>Undo</button>
        </p>
      ) : (
        <>
          <p className="q">{a.question}</p>
          <p className={`status-note ${stillFlagged ? "open" : "ok"}`}>
            {stillFlagged ? "Still flagged by the rule checks." : "The rule checks no longer flag this. Mark it resolved."}
          </p>
          {fixes.length > 0 && (
            <div className="fixes">
              {fixes.map((f) => (
                <button
                  key={f.label}
                  className="fix"
                  type="button"
                  onClick={() => {
                    if (f.edits.length > 0) dispatch({ type: "edit", edits: f.edits });
                    resolve(f.action, f.note);
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          <FieldEditor a={a} edited={edited} dispatch={dispatch} />
          <div className="row" style={{ marginTop: 10 }}>
            <select aria-label="How you resolved it" value={action} onChange={(e) => setAction(e.target.value as Resolution["action"])} style={{ border: "1px solid var(--rule)", background: "var(--paper)", borderRadius: 4, padding: "6px 8px" }}>
              <option value="edited">Edited the checklist</option>
              <option value="clause-removed">Removed the clause</option>
              <option value="acknowledged">Acknowledged as is</option>
            </select>
            <input aria-label="Note (required)" placeholder="Why? (at least 5 characters)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn secondary" type="button" disabled={!noteOk || cannotAck} onClick={() => resolve(action, note.trim())}>
              Resolve
            </button>
          </div>
          {cannotAck && <p className="why">Blocking issues must be fixed, not just acknowledged.</p>}
        </>
      )}
    </div>
  );
}

// ───────────────────────────── The step ─────────────────────────────

export function StepResolve(props: {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  required: Ambiguity[];
  editedIds: Set<string>;
  summary: GateSummary;
  resolvedBy: "client" | "provider";
  onNext: () => void;
}) {
  const { state, dispatch, required, editedIds, summary, resolvedBy, onNext } = props;
  const [hover, setHover] = useState<string | null>(null);
  const edited = state.edited!;
  const resolvedCount = required.filter((a) => state.resolutions[a.id]).length;

  const reasons = gateReasons(summary, false);
  const passes = reasons.length === 0 ? ["Every issue is resolved and re-checked. Continue to review the confirmed terms."] : [];

  return (
    <>
      <div className="studio">
        <div className="panel doc">
          <div className="doc-head">
            <div>
              <h1>{edited.title || "Agreement"}</h1>
              <p className="muted small">Highlights are terms the AI or the rule checks flagged. Click one to jump to it.</p>
            </div>
          </div>
          <DocView
            text={state.text}
            flags={required}
            milestoneQuotes={state.extraction!.proposed.milestones.map((m) => m.quote)}
            resolutions={state.resolutions}
            hover={hover}
            onMarkClick={(id) => document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
          />
        </div>
        <aside className="panel rail" aria-label="Issues to resolve">
          <div className="rail-head">
            <h2>Resolve before money locks</h2>
            <span className="mono" id="count">
              {resolvedCount} / {required.length}
            </span>
          </div>
          <div className="meter">
            <span style={{ width: `${required.length ? (resolvedCount / required.length) * 100 : 100}%` }} />
          </div>
          <div id="cards">
            {required.length === 0 && <p className="muted">Nothing was flagged. You can continue.</p>}
            {required.map((a, idx) => (
              <AmbiguityCard
                key={a.id}
                a={a}
                n={idx + 1}
                edited={edited}
                resolution={state.resolutions[a.id]}
                stillFlagged={editedIds.has(a.id)}
                resolvedBy={resolvedBy}
                dispatch={dispatch}
                onHover={setHover}
              />
            ))}
          </div>
        </aside>
      </div>
      <GateBar reasons={reasons} passes={passes} label="Review confirmed terms" onClick={onNext} />
    </>
  );
}
