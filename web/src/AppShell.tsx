import { AppProvider, useApp } from "./lib/app";
import { matchRoute, usePath } from "./lib/router";
import { ToastProvider } from "./ui/toast";
import { TopBar } from "./ui/TopBar";
import { Onboarding, useOnboarding } from "./ui/Onboarding";
import { MST } from "./lib/mstNetwork";
import { onMst, switchWalletToMst, useWalletState } from "./lib/wallet";
import { Dashboard } from "./pages/Dashboard";
import { Vaults } from "./pages/Vaults";
import { Wizard } from "./pages/agreement/Wizard";
import { VaultPage } from "./pages/vault/VaultPage";
import { AttackLab } from "./pages/AttackLab";
import deployment from "./generated/deployment.json";
import { isHosted } from "./lib/hosted";
import { Assistant } from "./ui/Assistant";
import "./ui/dashboard.css";
import "./ui/calm.css";

function Banners() {
  const app = useApp();
  const ws = useWalletState();
  const onboarding = useOnboarding();
  if (app.net === "wallet") {
    return (
      <>
        {!app.chainOnline && (
          <div className="banner bad" role="alert">
            Can't reach {MST.name} through its public RPC right now. Reads retry on their own; check your connection.
          </div>
        )}
        {ws.account && !onMst(ws) && (
          <div className="banner bad wallet-banner" role="alert" data-testid="wrong-network">
            <span>Your wallet is on another network. Sealstone only works on {MST.name} (chainId {MST.chainId}).</span>
            <button className="btn go" type="button" onClick={() => void switchWalletToMst().catch(() => undefined)}>Switch to {MST.name}</button>
          </div>
        )}
        {!ws.account && (
          <div className="banner wallet-banner" role="status" data-testid="viewer-banner">
            <span>You're looking without a wallet. Everything is readable; to act on a vault, connect one.</span>
            <button className="btn secondary" type="button" onClick={onboarding.disconnect}>Connect a wallet</button>
          </div>
        )}
      </>
    );
  }
  return (
    <>
      {!app.chainOnline && (
        <div className="banner bad" role="alert">
          Can't reach the local chain at {deployment.rpcUrl.replace("http://", "")}. Start it with <code>npm run chain</code>.
        </div>
      )}
      {app.serverOnline === false && !isHosted && (
        <div className="banner" role="status">
          The AI service isn't running. Start it with <code>npm run server</code>. You can still use the built-in rules.
        </div>
      )}
    </>
  );
}

function Routes() {
  const route = matchRoute(usePath());
  switch (route.name) {
    case "dashboard":
      return <Dashboard />;
    case "vaults":
      return <Vaults />;
    case "agreement":
      return <Wizard />;
    case "vault":
      return <VaultPage key={route.address} address={route.address} />;
    case "lab":
      return <AttackLab />;
    default:
      return (
        <div className="panel" style={{ padding: 24 }}>
          <h1>Page not found</h1>
          <p className="muted">Use the menu to open the Dashboard, the Vaults, the Agreement studio or the Attack Lab.</p>
        </div>
      );
  }
}

/** Everything that talks to the chain and the AI service. Loaded only for app routes, so the landing page stays light. */
export default function AppShell() {
  return (
    <AppProvider>
      <ToastProvider>
        <Onboarding>
          <TopBar />
          <Banners />
          <main>
            <Routes />
          </main>
        <Assistant />
        </Onboarding>
      </ToastProvider>
    </AppProvider>
  );
}
