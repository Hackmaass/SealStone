import { z } from "zod";

/**
 * The Sealstone assistant is PROPOSAL-ONLY. It answers questions and suggests actions; a person clicks each suggestion.
 * Every action is on this fixed list and is checked here, so a model can never invent one. There is deliberately NO action
 * that signs, funds, approves, disputes, resolves, withdraws or sends any transaction: money moves only through the app's own
 * confirmation sheets, decided by a person and enforced by the contract ("AI proposes, you decide, the contract enforces").
 */
export const ASSISTANT_PAGES = ["/dashboard", "/vaults", "/agreement", "/attack-lab"] as const;
const label = z.string().min(1).max(80);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const assistantActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), to: z.enum(ASSISTANT_PAGES), label }),
  z.object({ type: z.literal("openVault"), address: z.string().regex(ADDRESS), label }),
  z.object({ type: z.literal("setRole"), role: z.enum(["client", "provider", "arbiter", "stranger"]), label }),
  z.object({ type: z.literal("toggle"), what: z.enum(["theme", "presenter"]), label }),
]);
export type AssistantAction = z.infer<typeof assistantActionSchema>;

/** What the browser tells the assistant about the screen. Read-only facts; nothing here can carry an instruction to the chain. */
export interface AssistantContext {
  path: string;
  role: "client" | "provider" | "arbiter" | "stranger";
  roleName: string;
  chainOnline: boolean;
  vaults: Array<{ address: string; title: string; state: string; next: string; mine: boolean; ledgerOk: boolean }>;
}

export const assistantContextSchema = z.object({
  path: z.string().max(200),
  role: z.enum(["client", "provider", "arbiter", "stranger"]),
  roleName: z.string().max(80),
  chainOnline: z.boolean(),
  vaults: z
    .array(z.object({ address: z.string().regex(ADDRESS), title: z.string().max(160), state: z.string().max(40), next: z.string().max(300), mine: z.boolean(), ledgerOk: z.boolean() }))
    .max(12),
});

export const assistantMessageSchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(2000) });

export interface AssistantReply {
  reply: string;
  actions: AssistantAction[];
}

/** Keeps only valid actions (at most 3), and only vaults the page really listed. Anything else a model says is dropped, not repaired. */
export function sanitizeActions(raw: unknown, ctx: AssistantContext): AssistantAction[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(ctx.vaults.map((v) => v.address.toLowerCase()));
  const out: AssistantAction[] = [];
  for (const item of raw) {
    const parsed = assistantActionSchema.safeParse(item);
    if (!parsed.success) continue;
    if (parsed.data.type === "openVault" && !known.has(parsed.data.address.toLowerCase())) continue;
    out.push(parsed.data);
    if (out.length === 3) break;
  }
  return out;
}

export const HELP_TEXT =
  "I can explain Sealstone, tell you what is waiting on you, and suggest where to go next (dashboard, vaults, agreement studio, Attack Lab) or who to act as. I only suggest: you click, and money only moves through the confirmation sheets, never through me.";

const ROLE_WORDS: Array<[RegExp, AssistantContext["role"], string]> = [
  [/\b(client|incubation)\b/, "client", "client"],
  [/\b(provider|freelancer|krishilens)\b/, "provider", "provider"],
  [/\b(arbiter|referee|mentor)\b/, "arbiter", "arbiter"],
  [/\b(stranger|anyone|outsider)\b/, "stranger", "stranger"],
];

/**
 * The offline brain: plain keyword intents over the same context, with no model. It is the fallback when no AI service is
 * reachable (Wi-Fi off, server down, mode "rules"), so the assistant never depends on an outside service.
 */
export function ruleReply(rawText: string, ctx: AssistantContext): AssistantReply {
  const t = rawText.toLowerCase();
  const nav = (to: (typeof ASSISTANT_PAGES)[number], text: string, name: string): AssistantReply => ({ reply: text, actions: [{ type: "navigate", to, label: name }] });

  const asRole = /\b(act as|switch to|be the|become|log in as|use the)\b/.test(t) ? ROLE_WORDS.find(([re]) => re.test(t)) : undefined;
  if (asRole) return { reply: `Suggested: act as the ${asRole[2]}. Each role sees only the moves it is allowed to make.`, actions: [{ type: "setRole", role: asRole[1], label: `Act as the ${asRole[2]}` }] };

  if (/\b(attack|hack|break|exploit|re-?entran|security lab|adversar)/.test(t)) return nav("/attack-lab", "The Attack Lab fires 12 real attacks at a fresh sandbox vault, plus the same re-entrancy attack against a naive escrow. Press Run all attacks there.", "Open the Attack Lab");
  if (/\b(draft|new agreement|studio|paste|extract|ambigu)/.test(t) || /\bagreement\b/.test(t)) return nav("/agreement", "The agreement studio turns agreement text into a proposed checklist and flags every ambiguity. Confirm stays locked until a person resolves each one.", "Open the agreement studio");
  if (/\b(vaults|list of vaults|all vaults)\b/.test(t)) return nav("/vaults", "Here is the list of every vault on this chain.", "Open the vaults");
  if (/\b(dashboard|home|overview)\b/.test(t)) return nav("/dashboard", "The dashboard shows what is locked, owed and waiting, read live from the chain.", "Open the dashboard");

  if (/\b(dark|light|theme)\b/.test(t)) return { reply: "I can switch the theme for you.", actions: [{ type: "toggle", what: "theme", label: "Switch theme" }] };
  if (/\bpresent(er|ation)\b/.test(t)) return { reply: "Presenter mode makes everything larger for a projector.", actions: [{ type: "toggle", what: "presenter", label: "Toggle presenter mode" }] };

  if (/\b(what'?s next|what is next|what should i do|my move|waiting|todo|to do|next step)\b/.test(t)) {
    if (!ctx.chainOnline) return { reply: "I can't reach the local chain, so I can't see any vault. Start it with npm run dev.", actions: [] };
    const mine = ctx.vaults.filter((v) => v.mine);
    if (mine.length > 0) {
      return {
        reply: `${mine.length === 1 ? "One thing is" : `${mine.length} things are`} waiting on ${ctx.roleName}: ${mine.map((v) => `${v.title}: ${v.next}`).join(" ")}`,
        actions: mine.slice(0, 3).map((v) => ({ type: "openVault" as const, address: v.address, label: `Open ${v.title}`.slice(0, 80) })),
      };
    }
    const first = ctx.vaults[0];
    return { reply: first ? `Nothing is waiting on ${ctx.roleName}. ${first.title}: ${first.next}` : "There are no vaults yet. Draft an agreement to create one.", actions: first ? [{ type: "openVault", address: first.address, label: `Open ${first.title}`.slice(0, 80) }] : [] };
  }

  if (/\b(ledger|reconcil|balance|surplus|books)\b/.test(t)) {
    if (ctx.vaults.length === 0) return { reply: "There are no vaults to check yet.", actions: [] };
    const bad = ctx.vaults.filter((v) => !v.ledgerOk);
    return { reply: bad.length === 0 ? `All ${ctx.vaults.length} ledger${ctx.vaults.length === 1 ? "" : "s"} reconcile: the contract's balance equals deposits minus withdrawals. Forced ETH would show as surplus and never be counted.` : `${bad.length} vault ledger${bad.length === 1 ? "" : "s"} do not reconcile: ${bad.map((v) => v.title).join(", ")}.`, actions: [] };
  }

  if (/\b(sign|fund|approve|release|refund|withdraw|dispute|pay|send|transfer)\b/.test(t)) {
    const mine = ctx.vaults.find((v) => v.mine);
    return {
      reply: "I never move money or send transactions. Those steps open the normal confirmation sheet in the vault, where a person clicks Confirm and the contract checks the rules." + (mine ? ` Your current move: ${mine.title}: ${mine.next}` : ""),
      actions: mine ? [{ type: "openVault", address: mine.address, label: `Open ${mine.title}`.slice(0, 80) }] : [],
    };
  }

  return { reply: HELP_TEXT, actions: [] };
}
