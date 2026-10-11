import { useEffect, useRef, type ReactNode } from "react";
import { formatWei, shortHash } from "./copy";
import { useToast } from "./toast";
import { formatRawError, type DecodedRevert } from "../lib/revert";
import { UNIT } from "../lib/units";

export type SealState = "proposed" | "submitted" | "onchain" | "mismatch";

/** One radial stroke per hex digit: length from the digit's value. Same hash, same seal; different hash, obviously different. */
export function HashSeal({ hash, state = "submitted", size = 40, draw = false }: { hash: string; state?: SealState; size?: number; draw?: boolean }) {
  const hex = hash.replace(/^0x/, "").padEnd(64, "0");
  const lines = [];
  for (let i = 0; i < 64; i++) {
    const v = parseInt(hex[i], 16) || 0;
    const a = (i / 64) * Math.PI * 2 - Math.PI / 2;
    const r1 = 22;
    const r2 = 26 + v * 1.25;
    lines.push(
      <line
        key={i}
        pathLength={1}
        x1={(50 + r1 * Math.cos(a)).toFixed(2)}
        y1={(50 + r1 * Math.sin(a)).toFixed(2)}
        x2={(50 + r2 * Math.cos(a)).toFixed(2)}
        y2={(50 + r2 * Math.sin(a)).toFixed(2)}
        strokeWidth={1.6}
        style={{ animationDelay: `${i * 5}ms` }}
      />,
    );
  }
  const b = parseInt(hex.slice(0, 2), 16) || 0;
  return (
    <svg className={`seal ${state}${draw ? " draw" : ""}`} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`Seal for hash ${shortHash(hash)}`}>
      <circle cx="50" cy="50" r="17" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="50" cy="50" r={6 + (b % 6)} fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray={`${2 + (b % 4)} ${2 + ((b >> 2) % 3)}`} />
      <circle cx="50" cy="50" r="2.2" fill="currentColor" />
      {lines}
    </svg>
  );
}

/** 0x9f3a…c41e with a copy button and the full hash in a tooltip. Never replaces the hex. */
export function HashText({ hash }: { hash: string }) {
  const { toast } = useToast();
  return (
    <span className="hash" title={hash}>
      {shortHash(hash)}{" "}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(hash);
          toast("Hash copied");
        }}
      >
        copy
      </button>
    </span>
  );
}

/** wei bigint -> "1.000 ETH". Tabular mono, never floats. */
export function Amount({ wei, unit = true, decimals = 3 }: { wei: bigint; unit?: boolean; decimals?: number }) {
  return (
    <span className="mono">
      {formatWei(wei, decimals)}
      {unit ? ` ${UNIT}` : ""}
    </span>
  );
}

export type Role = "client" | "provider" | "arbiter" | "stranger";
export const ROLE_LABEL: Record<Role, string> = { client: "Client", provider: "Provider", arbiter: "Arbiter", stranger: "Anyone" };

export function RoleChip({ role, name, address }: { role: Role; name: string; address?: string }) {
  return (
    <span className="facts">
      <span className="f">
        <span className={`dot${role === "stranger" ? " amber" : ""}`} />
        <b>{name}</b>
        <span className="muted small">{ROLE_LABEL[role]}</span>
        {address && <span className="hash">{shortHash(address)}</span>}
      </span>
    </span>
  );
}

export type MilestoneStateName = "Pending" | "Completed" | "Disputed" | "Released" | "Refunded";
const BADGE: Record<MilestoneStateName, { cls: string; icon: string }> = {
  Pending: { cls: "pending", icon: "○" },
  Completed: { cls: "proposed", icon: "◉" },
  Disputed: { cls: "revert", icon: "!" },
  Released: { cls: "onchain", icon: "✓" },
  Refunded: { cls: "human", icon: "↩" },
};

/** An icon AND a word: state is never shown by colour alone. */
export function StateBadge({ state }: { state: MilestoneStateName | string }) {
  const b = BADGE[state as MilestoneStateName] ?? { cls: "pending", icon: "·" };
  return (
    <span className={`chip ${b.cls}`}>
      <span aria-hidden="true">{b.icon}</span>
      {state}
    </span>
  );
}

/** Pending - Completed - Released, with the dispute branch (Completed - Disputed - arbiter's ruling). */
export function StateTrack({ state, disputed = false }: { state: MilestoneStateName; disputed?: boolean }) {
  if (state === "Disputed" || state === "Refunded" || disputed) {
    return (
      <div className="track">
        <span className="st done"><i />Pending</span><span className="bar done" />
        <span className="st done"><i />Completed</span><span className="bar done" />
        <span className={`st ${state === "Disputed" ? "now" : "done"}`}><i />Disputed</span>
        <span className={`bar ${state !== "Disputed" ? "done" : ""}`} />
        <span className={`st ${state === "Refunded" || state === "Released" ? "done" : ""}`}>
          <i />
          {state === "Refunded" ? "Refunded" : state === "Released" ? "Released by arbiter" : "Arbiter decides"}
        </span>
      </div>
    );
  }
  const order: MilestoneStateName[] = ["Pending", "Completed", "Released"];
  const k = order.indexOf(state);
  return (
    <div className="track">
      {order.map((o, j) => (
        <span key={o} style={{ display: "contents" }}>
          {j > 0 && <span className={`bar ${j <= k ? "done" : ""}`} />}
          <span className={`st ${j < k || (j === k && state === "Released") ? "done" : j === k ? "now" : ""}`}><i />{o}</span>
        </span>
      ))}
    </div>
  );
}

/** Plain-English refusal first, then the raw error and args (Tenderly style). Ends with "Nothing changed.". */
export function RevertNotice({ d }: { d: DecodedRevert }) {
  return (
    <div className="revert" role="alert">
      <b>{d.title}.</b> {d.detail ? `${d.detail} ` : ""}Nothing changed, and your funds haven't moved.
      <div className="raw">{formatRawError(d)}</div>
    </div>
  );
}

/** Modal sheet (Rabby-style preview before a money-moving transaction). Esc and the scrim close it. */
export function ActionSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>("button,input,textarea")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim on" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" ref={ref}>{children}</div>
    </div>
  );
}

/** Sticky bar listing WHY Confirm is locked, with the primary action. */
export function GateBar({
  reasons,
  passes = [],
  label,
  busy,
  onClick,
}: {
  reasons: string[];
  passes?: string[];
  label: string;
  busy?: boolean;
  onClick: () => void;
}) {
  const locked = reasons.length > 0;
  return (
    <div className="gate">
      <div style={{ flex: 1 }}>
        <ul>
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
          {passes.map((p) => (
            <li key={p} className="pass">{p}</li>
          ))}
        </ul>
      </div>
      <button className="btn go" disabled={locked || busy} onClick={onClick} title={locked ? "Resolve the items on the left first" : undefined}>
        {busy ? "Working…" : label}
      </button>
    </div>
  );
}
