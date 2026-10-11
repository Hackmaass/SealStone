import { Component, lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { matchRoute, usePath } from "./lib/router";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A lazy page that retries a couple of times if its file cannot be fetched (a dropped connection, a dev server restarting). */
function lazyRetry<T extends ComponentType<object>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    let last: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        return await load();
      } catch (e) {
        last = e;
        await sleep(400 * (i + 1));
      }
    }
    throw last;
  });
}

// Two layouts, loaded separately: the marketing landing page (no chain, no providers, no ethers) and the app.
const Landing = lazyRetry(() => import("./pages/landing/Landing"));
const AppShell = lazyRetry(() => import("./AppShell"));

function Loading() {
  return <div className="boot" role="status" aria-label="Loading" />;
}

/** If a part of the app cannot be loaded at all, say so in plain words instead of leaving a blank page. */
class LoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="boot-error" role="alert">
        <h1>Sealstone couldn't load this page</h1>
        <p>Part of the app didn't arrive. If you are running it yourself, check that <code>npm run dev</code> is still running, then reload.</p>
        <button className="btn go" type="button" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

export default function App() {
  const route = matchRoute(usePath());
  return (
    <LoadBoundary>
      <Suspense fallback={<Loading />}>{route.name === "landing" ? <Landing /> : <AppShell />}</Suspense>
    </LoadBoundary>
  );
}
