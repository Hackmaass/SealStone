import { useState } from "react";
import { shortHash } from "./copy";
import type { TimelineEntry } from "../lib/vaultModel";

/**
 * Activity reads top to bottom like a story, newest first. Rejected attempts sit in place (they never reach the
 * chain, so they come from this browser) and are marked, so the audience sees the attacks that failed too.
 */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  const [showRejected, setShowRejected] = useState(true);
  const rejected = entries.filter((e) => !e.ok).length;
  const shown = showRejected ? entries : entries.filter((e) => e.ok);
  return (
    <section className="panel activity" aria-label="Activity">
      <div className="ledger-head" style={{ marginBottom: 0 }}>
        <h2>Activity</h2>
        {rejected > 0 && (
          <label className="muted small" style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} />
            Show {rejected} rejected
          </label>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="muted small" style={{ marginTop: 10 }}>Nothing has happened in this vault yet.</p>
      ) : (
        <ol>
          {shown.map((e) => (
            <li key={e.id} className={e.ok ? "" : "bad"} data-ok={e.ok}>
              <span className="ic" aria-hidden="true">{e.ok ? "✓" : "✕"}</span>
              <div>
                <span className="sr-only">{e.ok ? "Done: " : "Rejected: "}</span>
                {e.title}
                <div className="meta">
                  {e.meta}
                  {e.txHash && <> · <span className="mono" title={e.txHash}>{shortHash(e.txHash)}</span></>}
                </div>
                {e.details.length > 0 && (
                  <details className="raw-details">
                    <summary>{e.ok ? "Raw events" : "Raw error"}</summary>
                    {e.details.map((d, i) => (
                      <div key={i} className="mono small">{d}</div>
                    ))}
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
