import { AppProvider, useApp } from "./lib/app";
import { matchRoute, usePath } from "./lib/router";
import { ToastProvider } from "./ui/toast";
import { TopBar } from "./ui/TopBar";
import { Home } from "./pages/Home";
import { Wizard } from "./pages/agreement/Wizard";
import { VaultPage } from "./pages/Vault";
import { AttackLab } from "./pages/AttackLab";
import deployment from "./generated/deployment.json";

function Banners() {
  const app = useApp();
  return (
    <>
      {!app.chainOnline && (
        <div className="banner bad" role="alert">
          Can't reach the local chain at {deployment.rpcUrl.replace("http://", "")}. Start it with <code>npm run chain</code>.
        </div>
      )}
      {app.serverOnline === false && (
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
    case "home":
      return <Home />;
    case "agreement":
      return <Wizard />;
    case "vault":
      return <VaultPage address={route.address} />;
    case "lab":
      return <AttackLab />;
    default:
      return (
        <div className="panel" style={{ padding: 24 }}>
          <h1>Page not found</h1>
          <p className="muted">Use the top bar to open the Agreement studio, the Vault or the Attack Lab.</p>
        </div>
      );
  }
}

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <TopBar />
        <Banners />
        <main>
          <Routes />
        </main>
      </ToastProvider>
    </AppProvider>
  );
}
