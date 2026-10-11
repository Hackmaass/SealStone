import deployment from "../generated/deployment.json";

/**
 * First-run experience: connect a (demo) wallet, then an optional guided tour of every part of the product.
 * Everything here is pure or storage-only, so it is unit-tested; the screens are ui/WalletGate.tsx and ui/Tour.tsx.
 *
 * Honesty rule: the app signs with Hardhat's unlocked test accounts (docs/01, CLAUDE.md), so "connecting" means choosing which of
 * those accounts you start as. It never asks a browser extension for anything.
 */

export const KEYS = { wallet: "mv.onboard.wallet", tour: "mv.onboard.tour", pendingTour: "mv.onboard.pendingTour", pendingRole: "mv.onboard.pendingRole" } as const;

// ───────────────────────── storage (never throws; falls back to memory when storage is blocked) ─────────────────────────
const memory = new Map<string, string>();

export function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeKey(key: string, value: string): void {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* blocked storage: the choice is remembered until the tab closes */
  }
}

export function removeKey(key: string): void {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to remove */
  }
}

/** "demo" = the local test accounts, "browser" = a real wallet on MST testnet (see lib/network.ts). */
export const isConnected = (): boolean => ["demo", "browser", "viewer"].includes(readKey(KEYS.wallet) ?? "");
export const tourSeen = (): boolean => ["done", "skipped"].includes(readKey(KEYS.tour) ?? "");

// ───────────────────────── the tour ─────────────────────────
export type TourMode = "full" | "quick";
export type StepIcon = "welcome" | "user" | "ai" | "chain" | "keys" | "money" | "list" | "steps" | "paste" | "seal" | "move" | "file" | "verify" | "ledger" | "withdraw" | "shield" | "duel" | "done";

export interface TourStep {
  id: string;
  chapter: string;
  title: string;
  /** one or two plain sentences */
  body: string;
  /** a labelled list under the body */
  points?: Array<{ k: string; v: string }>;
  /** a closing line: what to take away */
  note?: string;
  /** shown instead of `body` on a phone, where the real control lives in the menu */
  phoneBody?: string;
  icon: StepIcon;
  /** where this step lives; the tour opens it first. null = nothing to show here (for example no vault of your own yet): the step is skipped */
  route?: (ctx: TourCtx) => string | null;
  /** wording when the app runs against a real wallet on MST testnet (lib/network.ts) */
  wallet?: Partial<Pick<TourStep, "title" | "body" | "phoneBody" | "points" | "note">>;
  /** needs the local sandbox accounts, so it is left out in wallet mode */
  localOnly?: boolean;
  /** CSS selector(s) of the real element to spotlight; the first visible match wins (so a desktop and a phone control can share a step) */
  anchor?: string;
  /** in the short tour */
  quick?: boolean;
  /** a centred card with no spotlight */
  modal?: boolean;
}

/** What the tour needs to know about where it is running: local (the demo vault exists) or wallet (only this browser's own vaults). */
export interface TourCtx {
  net: "local" | "wallet";
  vault: string | null;
}
export const LOCAL_CTX: TourCtx = { net: "local", vault: null };

const vaultPath = (c: TourCtx): string | null => (c.net === "local" ? `/vault/${deployment.preseededVault.address}` : c.vault ? `/vault/${c.vault}` : null);

export const TOUR: TourStep[] = [
  {
    id: "welcome",
    chapter: "Welcome",
    title: "Welcome to Sealstone",
    body: "Escrow that can't be tricked by a vague agreement, a swapped file or a malicious contract. This tour shows every part of the product. Nothing in it moves money.",
    points: [
      { k: "Agreement", v: "AI drafts a checklist, a person resolves every doubt, and the terms are sealed." },
      { k: "Deliverable", v: "Approval is tied to the exact file, so a swapped file is refused." },
      { k: "Funds", v: "A strict state machine, pull payments and books that always reconcile." },
    ],
    icon: "welcome",
    quick: true,
    modal: true,
  },
  {
    id: "roles",
    chapter: "Your workspace",
    title: "Choose who you are acting as",
    body: "Every vault has four kinds of people. Switch between them to see what each is allowed to do. Anything they aren't allowed to do is refused with a clear reason.",
    points: [
      { k: "Client", v: "Funds the vault, approves or disputes work." },
      { k: "Provider", v: "Does the work and submits the file's fingerprint." },
      { k: "Arbiter", v: "Settles a dispute, nothing else." },
      { k: "Anyone", v: "A stranger. Can look, can't touch the money." },
    ],
    note: "Press 1, 2, 3 or 4 on your keyboard to switch.",
    phoneBody: "Every vault has a client, a provider, an arbiter and a stranger. The chip at the top shows who you are acting as. Tap it to switch, and see what each one is allowed to do.",
    wallet: {
      title: "Your wallet decides who you are",
      body: "Every vault has four kinds of people, and your role in a vault is simply which of its three addresses your wallet is on. To act as another party, switch accounts in your wallet. Anyone else is a stranger who can look but not touch.",
      note: "Every transaction opens your wallet so you can confirm or decline it.",
      phoneBody: "Your role in a vault is decided by which of its addresses your wallet is on. To act as another party, switch accounts in your wallet. Every transaction opens your wallet to confirm.",
    },
    icon: "user",
    anchor: '[data-tour="roles"]',
    quick: true,
  },
  {
    id: "wallet",
    chapter: "Your workspace",
    title: "Your demo wallet",
    body: "This is the test account you are using on the local chain: its address and balance. From here you can replay this tour or disconnect and start again as someone else.",
    note: "It signs with a built-in test account, so no browser extension is involved and no real money is at stake.",
    phoneBody: "Your demo wallet is a built-in test account on the local chain. Open the menu to replay this tour or to disconnect. No browser extension is involved.",
    wallet: {
      title: "Your wallet",
      body: "Your connected account, its tMSTC balance and the network, with links to the explorer and the faucet. If your wallet is ever on another network, a button switches it back to MST Testnet. From here you can also replay this tour or disconnect.",
      note: "Test coins only. Sealstone never sees your keys: your wallet signs.",
      phoneBody: "Open the menu for your connected account and balance. Your wallet signs everything, on MST Testnet, and can be disconnected from there.",
    },
    icon: "welcome",
    anchor: '[data-tour="wallet"], [data-tour="menu"]',
  },
  {
    id: "ai",
    chapter: "Your workspace",
    title: "Pick the AI model that drafts for you",
    body: "The AI reads an agreement and proposes a checklist. You choose where that AI runs. It always works with no internet, because the built-in rules are the last fallback.",
    points: [
      { k: "Auto", v: "Tries your local Ollama model, then Gemini if you added a key, then the built-in rules." },
      { k: "Ollama", v: "A small model on your own machine. Private, and no internet needed." },
      { k: "Gemini", v: "An optional cloud model, used only if you provide a key." },
      { k: "Rules (offline)", v: "No AI at all: a deterministic extractor that is always available." },
    ],
    note: "Whichever you pick, the AI only proposes. Rules re-check every number, a person confirms, and it never touches the chain.",
    phoneBody: "Open the menu to choose the AI: Auto, Ollama (local), Gemini (optional cloud) or Rules (offline). Whichever you pick, the AI only proposes. Rules re-check every number and a person confirms.",
    icon: "ai",
    anchor: '[data-tour="ai"], [data-tour="menu"]',
    quick: true,
  },
  {
    id: "chain",
    chapter: "Your workspace",
    title: "A private chain, simulated money",
    body: "Sealstone runs on a local test chain on your own computer. The block number moves each time something is recorded. There is no real money and no public network involved.",
    phoneBody: "Sealstone runs on a local test chain on your own computer, shown in the menu as the current block. There is no real money and no public network involved.",
    wallet: {
      title: "A public test network, not real money",
      body: "Sealstone reads MST Testnet, a public test network, and every action is a real transaction that your wallet confirms. The coin (tMSTC) is free from the faucet and has no value. The block number moves as the network records things.",
      phoneBody: "Sealstone runs on MST Testnet, a public test network. Every action is a real transaction your wallet confirms, with free test coins (tMSTC) that have no value.",
    },
    icon: "chain",
    anchor: '[data-tour="chain"], [data-tour="menu"]',
  },
  {
    id: "controls",
    chapter: "Your workspace",
    title: "Presenter mode, themes and shortcuts",
    body: "Presenter mode enlarges everything for a projector. The theme switch changes light and dark. Everything has a key.",
    points: [
      { k: "1 – 4", v: "Switch role" },
      { k: "P", v: "Presenter mode" },
      { k: "T", v: "Light or dark theme" },
      { k: "?", v: "Replay this tour" },
    ],
    phoneBody: "Presenter mode and the light and dark theme are in the menu. You can replay this tour from there any time.",
    icon: "keys",
    anchor: '[data-tour="presenter"], [data-tour="menu"]',
  },
  {
    id: "money",
    chapter: "Dashboard",
    title: "The money, in three numbers",
    body: "The dashboard adds up every vault from the chain itself. In escrow is locked and safe. Ready to withdraw is owed to someone. Withdrawn has already left.",
    note: "Contract balance always equals deposited minus withdrawn. The tick under the title turns red if it ever doesn't.",
    icon: "money",
    route: () => "/dashboard",
    anchor: '[data-tour="money"]',
    quick: true,
  },
  {
    id: "vaults",
    chapter: "Dashboard",
    title: "Every vault, and what needs you",
    body: "Each row is one agreement: its seal, its progress, the money in it and whether its books reconcile. Use the filters to jump to the ones waiting for your move, then open one.",
    icon: "list",
    route: () => "/dashboard",
    anchor: '[data-tour="attention"]',
  },
  {
    id: "studio-steps",
    chapter: "Agreement studio",
    title: "From a paragraph to a sealed agreement",
    body: "The studio walks one agreement through six stages. You can go back to any earlier stage until the contract is deployed.",
    points: [
      { k: "Paste", v: "Bring in the agreement text, or load a sample." },
      { k: "Proposal", v: "The AI's checklist: parties, milestones, amounts, deadlines." },
      { k: "Resolve", v: "Fix or acknowledge every doubt it found." },
      { k: "Confirm", v: "Review the final terms. This is the human gate." },
      { k: "Deploy", v: "Create the vault with the sealed terms." },
      { k: "Sign and fund", v: "Both sides sign the seal, then the client funds the exact total." },
    ],
    icon: "steps",
    route: () => "/agreement",
    anchor: '[data-tour="steps"]',
  },
  {
    id: "studio-paste",
    chapter: "Agreement studio",
    title: "AI proposes. You decide.",
    body: "Paste an agreement or load a sample, then press Extract. The AI highlights anything unclear, like \"to the mentor's satisfaction\" or a total that doesn't add up. Confirm stays locked until each flag is resolved.",
    note: "Only a confirmed, checked checklist can ever reach the contract. The AI's output never does.",
    icon: "paste",
    route: () => "/agreement",
    anchor: '[data-tour="paste"]',
    quick: true,
  },
  {
    id: "vault-seal",
    chapter: "Inside a vault",
    title: "The seal on the agreement",
    body: "This is the demo vault. The pattern is a fingerprint of the confirmed terms. Change one character of the agreement and the pattern changes completely.",
    icon: "seal",
    route: vaultPath,
    anchor: '[data-tour="vault-head"]',
  },
  {
    id: "your-move",
    chapter: "Inside a vault",
    title: "Always told what's next",
    body: "This box says what is waiting, who it is waiting for, and gives you the button if it is you. If it isn't your turn, it tells you whose it is and offers to switch.",
    icon: "move",
    route: vaultPath,
    anchor: '[data-tour="your-move"]',
  },
  {
    id: "milestones",
    chapter: "Inside a vault",
    title: "Approval is tied to the exact file",
    body: "The provider submits the SHA-256 fingerprint of the file. The client can approve only that exact file: choose a different one and the contract refuses with DeliverableHashMismatch, and no money moves.",
    points: [
      { k: "Pending", v: "Work not submitted yet." },
      { k: "Completed", v: "Submitted, waiting for the client's review." },
      { k: "Released", v: "Approved: the provider is credited." },
    ],
    icon: "file",
    route: vaultPath,
    anchor: '[data-tour="milestones"]',
    quick: true,
  },
  {
    id: "verify",
    chapter: "Inside a vault",
    title: "Check the terms yourself",
    body: "The contract stores only the seal. Open Verify the agreement to have your browser recompute it from the terms and compare. Edit a single character and watch it fail.",
    icon: "verify",
    route: vaultPath,
    anchor: '[data-tour="terms"]',
  },
  {
    id: "ledger",
    chapter: "Inside a vault",
    title: "Books that must balance",
    body: "The ledger is read from the contract's own reconcile() function after every action. If someone force-sends extra money in, it shows as surplus that nobody can withdraw, and the books still balance.",
    icon: "ledger",
    route: vaultPath,
    anchor: '[data-tour="ledger"]',
  },
  {
    id: "withdraw",
    chapter: "Inside a vault",
    title: "Pull payments: you take what you're owed",
    body: "Money is never pushed to anyone. When a milestone is released, the amount is credited, and the person owed it withdraws it. That is what makes re-entrancy attacks pointless.",
    icon: "withdraw",
    route: vaultPath,
    anchor: '[data-tour="withdraw"]',
  },
  {
    id: "lab",
    chapter: "Attack Lab",
    title: "Try to break it",
    body: "Run all attacks fires twelve real transactions at fresh sandbox vaults: a second release, a refund by a stranger, a skipped step, a re-entrancy attack, forced-in money and more. Your demo vaults are never touched.",
    note: "Starred rows are the four attacks the problem statement requires. Each row links to the test that proves it.",
    icon: "shield",
    route: () => "/attack-lab",
    anchor: '[data-tour="lab-head"]',
    quick: true,
    localOnly: true,
  },
  {
    id: "duel",
    chapter: "Attack Lab",
    title: "Same attack, two escrows",
    body: "Run the comparison to see the same re-entrancy attack against a naive escrow and against a Sealstone vault: the naive one is drained, ours isn't, and its books still balance.",
    icon: "duel",
    route: () => "/attack-lab",
    anchor: '[data-tour="duel"]',
    localOnly: true,
  },
  {
    id: "done",
    chapter: "Done",
    title: "You're ready",
    body: "That's the whole product. Pick something to try first. Nothing here is real money, so you can't break anything that matters.",
    icon: "done",
    quick: true,
    modal: true,
  },
];

/**
 * The stops for this run. Wallet mode swaps in its own wording, drops the stops that need the local sandbox (the Attack Lab),
 * and drops the vault chapter when this browser has no vault of its own yet.
 */
export function stepsFor(mode: TourMode, ctx: TourCtx = LOCAL_CTX): TourStep[] {
  return (mode === "quick" ? TOUR.filter((s) => s.quick) : TOUR)
    .filter((s) => !(ctx.net === "wallet" && s.localOnly))
    .filter((s) => !s.route || s.route(ctx) !== null)
    .map((s) => (ctx.net === "wallet" && s.wallet ? { ...s, ...s.wallet } : s));
}

/** Chapter names in order, with how many steps each has in this mode. */
export function chaptersFor(mode: TourMode, ctx: TourCtx = LOCAL_CTX): Array<{ name: string; count: number; first: number }> {
  const out: Array<{ name: string; count: number; first: number }> = [];
  stepsFor(mode, ctx).forEach((s, i) => {
    const last = out[out.length - 1];
    if (last && last.name === s.chapter) last.count++;
    else out.push({ name: s.chapter, count: 1, first: i });
  });
  return out;
}

// ───────────────────────── tour state ─────────────────────────
export interface TourState {
  active: boolean;
  mode: TourMode;
  index: number;
  /** where the person was when the tour began, so leaving it puts them back */
  returnTo: string | null;
  /** local demo or a real wallet, and the vault the vault chapter shows */
  ctx: TourCtx;
}

export type TourAction =
  | { type: "start"; mode?: TourMode; from: string; ctx: TourCtx }
  | { type: "mode"; mode: TourMode }
  | { type: "next" }
  | { type: "back" }
  | { type: "goto"; index: number }
  | { type: "stop" };

export const TOUR_OFF: TourState = { active: false, mode: "full", index: 0, returnTo: null, ctx: LOCAL_CTX };

export function tourReducer(s: TourState, a: TourAction): TourState {
  const last = stepsFor(s.mode, s.ctx).length - 1;
  switch (a.type) {
    case "start":
      return { active: true, mode: a.mode ?? "full", index: 0, returnTo: a.from, ctx: a.ctx };
    case "mode":
      return { ...s, mode: a.mode, index: 0 };
    case "next":
      return s.active ? { ...s, index: Math.min(last, s.index + 1) } : s;
    case "back":
      return s.active ? { ...s, index: Math.max(0, s.index - 1) } : s;
    case "goto":
      return s.active ? { ...s, index: Math.max(0, Math.min(last, a.index)) } : s;
    case "stop":
      return { ...s, active: false };
  }
}

export const isLast = (s: TourState): boolean => s.index >= stepsFor(s.mode, s.ctx).length - 1;

/** What the person was about to open, in words, for the connect screen ("Continue to the Attack Lab"). */
export function intentLabel(path: string): string {
  if (path === "/attack-lab") return "the Attack Lab";
  if (path === "/agreement") return "the Agreement studio";
  if (path === "/vaults") return "your vaults";
  if (path.startsWith("/vault/")) return "this vault";
  return "the dashboard";
}
