import { SEVERITY_BY_TYPE, ambiguityId, type Ambiguity } from "../schema/proposed";

const key = (a: Pick<Ambiguity, "type" | "milestoneIndex">) => `${a.type}|${a.milestoneIndex ?? "agreement"}`;

/**
 * Merge the AI's ambiguities with the validator's.
 *  - de-duplicated on (type, milestoneIndex); ids are stable (`TYPE:index|agreement:0`)
 *  - the validator's severity always wins when both flagged the same thing
 *  - an AI-only flag gets the table severity (never "blocking" for VAGUE_CONDITION: only the validator decides that)
 *  - the validator can add or escalate, NEVER remove an AI flag
 * Output order is stable: agreement-level first, then by milestone, then by type.
 */
export function mergeAmbiguities(ai: Ambiguity[], validator: Ambiguity[]): Ambiguity[] {
  const merged = new Map<string, Ambiguity>();

  for (const a of ai) {
    if (merged.has(key(a))) continue;
    merged.set(key(a), {
      ...a,
      id: ambiguityId(a.type, a.milestoneIndex),
      origin: "ai",
      severity: SEVERITY_BY_TYPE[a.type],
    });
  }
  for (const v of validator) {
    const existing = merged.get(key(v));
    if (existing) {
      merged.set(key(v), { ...existing, severity: v.severity, quote: existing.quote ?? v.quote });
    } else {
      merged.set(key(v), { ...v, id: ambiguityId(v.type, v.milestoneIndex), origin: "validator" });
    }
  }

  return [...merged.values()].sort((x, y) => {
    const xi = x.milestoneIndex ?? -1;
    const yi = y.milestoneIndex ?? -1;
    return xi - yi || (x.type < y.type ? -1 : x.type > y.type ? 1 : 0);
  });
}
