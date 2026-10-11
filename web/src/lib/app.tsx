import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ACCOUNT_ROLES, accountAddress, provider, type AccountRole } from "./chain";
import { api, type Health, type Mode } from "./api";
import { NET, NOBODY, type Net } from "./network";
import { useWalletState } from "./wallet";

export interface PartyNames {
  client: string;
  provider: string;
  arbiter: string;
  stranger: string;
}

const DEFAULT_NAMES: PartyNames = { client: "Incubation Cell", provider: "KrishiLens team", arbiter: "Faculty mentor", stranger: "Stranger" };

export interface LastAi {
  source: "ollama" | "gemini" | "rules";
  model: string | null;
  latencyMs: number;
}

interface AppState {
  /** "local": Hardhat test accounts. "wallet": the visitor's own wallet on MST testnet (lib/network.ts). Fixed for the life of the page. */
  net: Net;
  /** Who is acting: the chosen test account (local) or the connected wallet's address (wallet; the zero address when nobody is connected). */
  me: string;
  /** a short name for `me`, for sentences like "You're acting as ..." */
  meLabel: string;
  /** wallet mode: the connected account, if any */
  walletAccount: string | null;
  /** wallet mode: its balance in tMSTC */
  walletBalance: bigint | null;
  roleIdx: number;
  role: AccountRole;
  setRoleIdx: (i: number) => void;
  names: PartyNames;
  setNames: (n: Partial<PartyNames>) => void;
  block: number | null;
  chainOnline: boolean;
  balances: Record<AccountRole, bigint | null>;
  health: Health | null;
  serverOnline: boolean | null;
  refreshHealth: () => void;
  aiMode: Mode;
  setAiMode: (m: Mode) => void;
  lastAi: LastAi | null;
  setLastAi: (a: LastAi | null) => void;
  theme: "light" | "dark" | null;
  toggleTheme: () => void;
  presenter: boolean;
  togglePresenter: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

const safeGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage blocked: the app works without it */
  }
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [roleIdx, setRoleIdx] = useState(0);
  const [names, setNamesState] = useState<PartyNames>(DEFAULT_NAMES);
  const [block, setBlock] = useState<number | null>(null);
  const [chainOnline, setChainOnline] = useState(true);
  const [balances, setBalances] = useState<Record<AccountRole, bigint | null>>({ client: null, provider: null, arbiter: null, stranger: null });
  const [health, setHealth] = useState<Health | null>(null);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [aiMode, setAiModeState] = useState<Mode>((safeGet("mv.aiMode") as Mode | null) ?? "auto");
  const [lastAi, setLastAi] = useState<LastAi | null>(null);
  const [theme, setTheme] = useState<"light" | "dark" | null>((safeGet("mv.theme") as "light" | "dark" | null) ?? "dark");
  const [presenter, setPresenter] = useState(false);
  const lastBlock = useRef<number | null>(null);
  const wallet = useWalletState();
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const walletAccount = NET === "wallet" ? wallet.account : null;

  // Poll the block number about once a second (every few seconds against a public RPC); read balances only when the block changes.
  useEffect(() => {
    let alive = true;
    // One refused request (this machine does that at random) is not "the chain is down": it takes 3 misses in a row.
    let misses = 0;
    const tick = async () => {
      try {
        const n = await provider.getBlockNumber();
        if (!alive) return;
        misses = 0;
        setChainOnline(true);
        setBlock(n);
        if (lastBlock.current !== n) {
          lastBlock.current = n;
          if (NET === "wallet") {
            if (walletAccount) setWalletBalance(await provider.getBalance(walletAccount));
          } else {
            const vals = await Promise.all(ACCOUNT_ROLES.map((r) => provider.getBalance(accountAddress(r))));
            if (alive) setBalances({ client: vals[0], provider: vals[1], arbiter: vals[2], stranger: vals[3] });
          }
        }
      } catch {
        if (alive && ++misses >= 3) setChainOnline(false);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), NET === "wallet" ? 5000 : 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [walletAccount]);

  // /api/health hits Ollama's tags endpoint, so poll sparingly.
  const refreshHealth = useCallback(() => {
    // On a hosted copy this calls /api on the same origin (the server service). If that service is absent, api.ts refuses to call loopback and this reports offline.
    api
      .health()
      .then((h) => {
        setHealth(h);
        setServerOnline(true);
      })
      .catch(() => {
        setHealth(null);
        setServerOnline(false);
      });
  }, []);
  useEffect(() => {
    refreshHealth();
    const t = setInterval(refreshHealth, 10_000);
    return () => clearInterval(t);
  }, [refreshHealth]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
    // leaving the app (for the landing page) must not leave the app's theme behind
    return () => {
      delete root.dataset.theme;
    };
  }, [theme]);
  useEffect(() => {
    document.documentElement.classList.toggle("presenter", presenter);
    return () => document.documentElement.classList.remove("presenter");
  }, [presenter]);

  const toggleTheme = useCallback(() => {
    setTheme((cur) => {
      const dark = cur !== "light"; // the app starts dark unless the person chose light
      const next = dark ? "light" : "dark";
      safeSet("mv.theme", next);
      return next;
    });
  }, []);
  const togglePresenter = useCallback(() => setPresenter((p) => !p), []);
  const setAiMode = useCallback((m: Mode) => {
    safeSet("mv.aiMode", m);
    setAiModeState(m);
  }, []);
  const setNames = useCallback((n: Partial<PartyNames>) => setNamesState((cur) => ({ ...cur, ...n })), []);

  // Keyboard: 1-4 switch role, P presenter, T theme. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.matches("input,textarea,select") || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key >= "1" && e.key <= "4") {
        if (NET === "local") setRoleIdx(Number(e.key) - 1); // with a real wallet, the wallet decides who you are
      }
      else if (e.key === "p" || e.key === "P") togglePresenter();
      else if (e.key === "t" || e.key === "T") toggleTheme();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePresenter, toggleTheme]);

  const me = NET === "wallet" ? (walletAccount ?? NOBODY) : accountAddress(ACCOUNT_ROLES[roleIdx]);
  const meLabel = NET === "wallet" ? (walletAccount ? `${walletAccount.slice(0, 6)}…${walletAccount.slice(-4)}` : "no wallet") : names[ACCOUNT_ROLES[roleIdx]];

  const value = useMemo<AppState>(
    () => ({
      net: NET,
      me,
      meLabel,
      walletAccount,
      walletBalance,
      roleIdx,
      role: ACCOUNT_ROLES[roleIdx],
      setRoleIdx,
      names,
      setNames,
      block,
      chainOnline,
      balances,
      health,
      serverOnline,
      refreshHealth,
      aiMode,
      setAiMode,
      lastAi,
      setLastAi,
      theme,
      toggleTheme,
      presenter,
      togglePresenter,
    }),
    [me, meLabel, walletAccount, walletBalance, roleIdx, names, setNames, block, chainOnline, balances, health, serverOnline, refreshHealth, aiMode, setAiMode, lastAi, theme, toggleTheme, presenter, togglePresenter],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
