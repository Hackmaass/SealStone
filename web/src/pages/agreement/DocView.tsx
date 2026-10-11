import { useMemo } from "react";
import type { Ambiguity, Resolution } from "@mv/shared";
import { buildSegments, locateAnchors } from "../../lib/highlight";

/** The agreement text with each flagged term marked (amber = open, blue = resolved). Clicking a mark jumps to its card. */
export function DocView({
  text,
  flags,
  milestoneQuotes,
  resolutions,
  hover = null,
  onMarkClick,
}: {
  text: string;
  flags: Ambiguity[];
  milestoneQuotes: Array<string | null>;
  resolutions: Record<string, Resolution>;
  hover?: string | null;
  onMarkClick?: (id: string) => void;
}) {
  const anchors = useMemo(
    () => locateAnchors(text, flags.map((a) => ({ id: a.id, quote: a.quote, milestoneIndex: a.milestoneIndex })), milestoneQuotes),
    [text, flags, milestoneQuotes],
  );
  const segments = useMemo(() => buildSegments(text, anchors), [text, anchors]);
  const numberOf = (id: string) => flags.findIndex((a) => a.id === id) + 1;
  return (
    <article id="doc">
      {segments.map((s, k) =>
        s.id ? (
          <mark
            key={k}
            className={`amb${resolutions[s.id] ? " res" : ""}${hover === s.id ? " flash" : ""}`}
            data-id={s.id}
            onClick={() => onMarkClick?.(s.id!)}
          >
            {s.text}
            <sup>{numberOf(s.id)}</sup>
          </mark>
        ) : (
          <span key={k}>{s.text}</span>
        ),
      )}
    </article>
  );
}
