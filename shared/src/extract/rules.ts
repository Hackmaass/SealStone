import { isObjectiveCondition } from "../validate/lexicon";
import type { ProposedChecklist, ProposedMilestone, Role } from "../schema/proposed";
import { normalizeSourceText } from "../text";

/**
 * Deterministic rules extractor: the always-available fallback (works with Wi-Fi off, no model).
 * It only READS structure out of the text (party lines, milestone headings, "<n> ETH" figures, dates).
 * It emits no ambiguities itself: the shared validator (which uses the same lexicon) raises every flag.
 */

const ROLE_WORDS: Record<Role, string[]> = {
  client: ["client", "funder", "payer", "buyer", "sponsor", "customer", "commissioner"],
  provider: ["provider", "contractor", "freelancer", "vendor", "developer", "seller", "supplier"],
  arbiter: ["arbiter", "arbitrator", "mediator", "mentor", "judge", "adjudicator", "referee"],
};

const EMPTY_NAME = /^(none|n\/a|na|tbd|tba|to be (decided|determined|agreed)|-+|\?+)$/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_RE = `(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?,?\\s+\\d{4}|${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})`;

const HEADING = /^\s*(?:(?:milestone|phase|stage|deliverable)\s*#?(\d+)|M(\d+))\s*[-–—:.)]*\s*(.*)$/i;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;

function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim().replace(/[.;]$/, "");
  return name === "" || EMPTY_NAME.test(name) ? null : name;
}

function extractParties(lines: string[]): ProposedChecklist["parties"] {
  const parties: ProposedChecklist["parties"] = {
    client: { name: null, quote: null },
    provider: { name: null, quote: null },
    arbiter: { name: null, quote: null },
  };
  for (const line of lines) {
    const trimmed = line.trim();
    // "Mentor (arbiter): Prof. X"
    const paren = /^(?:[\w .'-]+?)\s*\((client|provider|arbiter)\)\s*[:\-–]\s*(.+)$/i.exec(trimmed);
    if (paren) {
      const role = paren[1].toLowerCase() as Role;
      if (parties[role].name === null) parties[role] = { name: cleanName(paren[2]), quote: trimmed };
      continue;
    }
    for (const role of Object.keys(ROLE_WORDS) as Role[]) {
      const m = new RegExp(`^(?:the\\s+)?(?:${ROLE_WORDS[role].join("|")})\\s*[:\\-–]\\s*(.+)$`, "i").exec(trimmed);
      if (m && parties[role].name === null) parties[role] = { name: cleanName(m[1]), quote: trimmed };
    }
  }
  return parties;
}

function toIsoDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  let y: number, mo: number, d: number;
  if (iso) {
    [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const dmy = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\.?,?\\s+(\\d{4})$`, "i").exec(raw);
    const mdy = new RegExp(`^(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})$`, "i").exec(raw);
    if (dmy) [d, mo, y] = [Number(dmy[1]), MONTHS.indexOf(dmy[2].slice(0, 3).toLowerCase()) + 1, Number(dmy[3])];
    else if (mdy) [mo, d, y] = [MONTHS.indexOf(mdy[1].slice(0, 3).toLowerCase()) + 1, Number(mdy[2]), Number(mdy[3])];
    else return null;
  }
  const out = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const check = new Date(`${out}T00:00:00.000Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().startsWith(out) ? out : null;
}

/** The date that follows "Due"/"Deadline" (preferred) or "by"/"before"/"no later than". Dates without a year are ignored. */
function extractDeadline(body: string): string | null {
  for (const kw of ["(?:due|deadline)", "(?:by|no later than|on or before)"]) {
    const m = new RegExp(`\\b${kw}\\b[:\\s]*(?:on\\s+)?${DATE_RE}`, "i").exec(body);
    if (m) {
      const iso = toIsoDate(m[1]);
      if (iso) return iso;
    }
  }
  return null;
}

function extractAmount(body: string): string | null {
  const pay = /\b(?:payment|amount|pay|fee|price|worth)\b[^.\d]{0,20}?(\d[\d,]*(?:\.\d+)?)\s*(?:test[- ])?ETH\b/i.exec(body);
  if (pay) return pay[1].replace(/,/g, "");
  const all = [...body.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:test[- ])?ETH\b/gi)].map((m) => m[1].replace(/,/g, ""));
  return all.length === 1 ? all[0] : null;
}

function extractConditions(bullets: string[], body: string): string[] {
  if (bullets.length > 0) return bullets.map((b) => b.trim().replace(/[.;]$/, "")).filter(Boolean);
  return body
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim().replace(/[.;]$/, ""))
    .filter((s) => s !== "" && !/^(due|deadline|payment|amount|price|fee)\b/i.test(s) && !/\bETH\b/i.test(s));
}

function deliverableType(text: string): ProposedMilestone["deliverableType"] {
  if (/\b(git|commit|source code|repo(sitory)?|prototype|app|software|script|code)\b/i.test(text)) return "code";
  if (/\b(report|document|pdf|paper|write-?up|essay|survey|plan)\b/i.test(text)) return "document";
  return "other";
}

function splitMilestoneBlocks(lines: string[]): Array<{ rest: string; lines: string[] }> {
  const blocks: Array<{ rest: string; lines: string[] }> = [];
  let current: { rest: string; lines: string[] } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = HEADING.exec(line);
    if (h && (h[1] !== undefined || h[2] !== undefined)) {
      current = { rest: h[3].trim(), lines: [] };
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.trim() === "") {
      const next = lines.slice(i + 1).find((l) => l.trim() !== "");
      const continues = next !== undefined && (BULLET.test(next) || /^\s+\S/.test(next)) && !HEADING.test(next);
      if (!continues) current = null;
      continue;
    }
    current.lines.push(line);
  }
  return blocks;
}

export function extractWithRules(rawText: string): ProposedChecklist {
  const text = normalizeSourceText(rawText);
  const lines = text.split("\n");

  const title =
    lines.map((l) => l.trim()).find((l) => l !== "" && !/^(client|provider|arbiter|total)\b/i.test(l) && !HEADING.test(l)) ?? "Untitled agreement";

  const totalMatch =
    /^\s*total(?:\s+(?:amount|value|fee|budget|payment))?\s*[:\-–]\s*(\d[\d,]*(?:\.\d+)?)\s*(?:test[- ])?ETH\b/im.exec(text) ??
    /\btotal(?:\s+(?:amount|value|fee|budget))?\s+of\s+(\d[\d,]*(?:\.\d+)?)\s*(?:test[- ])?ETH\b/i.exec(text);

  const milestones: ProposedMilestone[] = splitMilestoneBlocks(lines).map((b, index) => {
    const bullets = b.lines.map((l) => BULLET.exec(l)?.[1]).filter((x): x is string => x !== undefined);
    const prose = b.lines.filter((l) => !BULLET.test(l)).map((l) => l.trim());
    // Title = text up to the first full stop/colon of the heading line; the remainder is body text.
    let milestoneTitle = b.rest;
    let remainder = "";
    const cut = /^(.*?)(?:[.:]\s+|[.:]$)(.*)$/.exec(b.rest);
    if (cut) [milestoneTitle, remainder] = [cut[1], cut[2]];
    if (milestoneTitle === "" && prose.length > 0) milestoneTitle = prose.shift() ?? "";
    const body = [remainder, ...prose].join(" ").replace(/\s+/g, " ").trim();
    const full = [b.rest, ...b.lines.map((l) => l.trim())].join("\n").trim();
    const conditions = extractConditions(bullets, body).map((t) => ({ text: t, objective: isObjectiveCondition(t) }));
    return {
      index,
      title: milestoneTitle.trim().replace(/[.:]$/, "") || `Milestone ${index + 1}`,
      amount: extractAmount(full),
      conditions,
      deadline: extractDeadline(full),
      deliverableType: deliverableType(full),
      quote: full === "" ? null : full.slice(0, 800),
    };
  });

  return {
    schemaVersion: 1,
    source: "rules",
    title,
    parties: extractParties(lines),
    currency: /\bETH\b/i.test(text) ? "ETH" : null,
    totalStated: totalMatch ? totalMatch[1].replace(/,/g, "") : null,
    milestones,
    ambiguities: [],
    confidence: 0.5,
  };
}
