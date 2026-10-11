import { HELP_TEXT, ruleReply, sanitizeActions, type AssistantAction, type AssistantContext } from "@mv/shared";
import { chatAdvisory, parseJsonLoose, type ChatMode, type ChatSource } from "./llm";
import type { AiDeps } from "./index";

const SYSTEM = `You are the Sealstone assistant inside a web app for milestone escrow. Sealstone's promise: AI proposes, a person decides, the smart contract enforces.
Facts you may use:
- Three integrity layers: (1) agreement integrity: AI proposes a checklist and flags ambiguities, rules re-check it, a person resolves every flag, the keccak256 of the confirmed checklist is stored on-chain and both parties sign it; (2) deliverable integrity: the provider commits the file's SHA-256 and the client can approve only that exact file; (3) fund integrity: role-gated states, pull payments, a re-entrancy guard, and a live ledger that reconciles after every action.
- Roles: client (pays and approves), provider (delivers), arbiter (decides disputes), stranger (can do nothing).
- Pages: /dashboard, /vaults, /agreement (agreement studio), /attack-lab (12 real attacks plus a naive-escrow contrast).
Hard rules:
- You can NEVER sign, fund, approve, dispute, resolve, withdraw or send any transaction, and you must never say or imply that you did. Those steps happen in the app's confirmation sheets, clicked by a person.
- You only SUGGEST actions. Never claim an action already happened.
- Use only the facts in CONTEXT for vault state. If you do not know, say so. Keep replies under 80 words, plain and friendly.
Reply with ONLY a JSON object: {"reply": string, "actions": [ ... ]}. Allowed actions (at most 3), each with a short "label":
{"type":"navigate","to":"/dashboard"|"/vaults"|"/agreement"|"/attack-lab","label":"..."}
{"type":"openVault","address":"0x... (copied from CONTEXT)","label":"..."}
{"type":"setRole","role":"client"|"provider"|"arbiter"|"stranger","label":"..."}
{"type":"toggle","what":"theme"|"presenter","label":"..."}`;

export interface AssistantAnswer {
  reply: string;
  actions: AssistantAction[];
  meta: { source: ChatSource; model: string | null; latencyMs: number; fallbackReason: string | null };
}

export async function assist(
  input: { messages: Array<{ role: "user" | "assistant"; text: string }>; context: AssistantContext; mode: ChatMode },
  deps: AiDeps,
): Promise<AssistantAnswer> {
  const last = input.messages[input.messages.length - 1];
  const history = input.messages.slice(-7, -1).map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n");
  const user = `CONTEXT:\n${JSON.stringify(input.context)}\n\n${history ? `EARLIER:\n${history}\n\n` : ""}USER: ${last.text}`;
  const r = await chatAdvisory({ deps, mode: input.mode, system: SYSTEM, user });

  if (r.text !== null) {
    const json = parseJsonLoose(r.text) as { reply?: unknown; actions?: unknown } | null;
    const reply = typeof json?.reply === "string" && json.reply.trim() ? json.reply.trim().slice(0, 1200) : null;
    if (reply) {
      return { reply, actions: sanitizeActions(json?.actions, input.context), meta: { source: r.source, model: r.model, latencyMs: r.latencyMs, fallbackReason: null } };
    }
    // The model answered in plain prose instead of JSON: keep the words, offer no actions.
    const prose = r.text.trim();
    if (prose && !prose.startsWith("{")) {
      return { reply: prose.slice(0, 1200), actions: [], meta: { source: r.source, model: r.model, latencyMs: r.latencyMs, fallbackReason: null } };
    }
  }
  const rules = ruleReply(last.text, input.context);
  return { reply: rules.reply || HELP_TEXT, actions: rules.actions, meta: { source: "rules", model: null, latencyMs: r.latencyMs, fallbackReason: r.fallbackReason ?? (r.text !== null ? "The model's answer could not be read" : null) } };
}
