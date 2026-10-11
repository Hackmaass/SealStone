import { useSyncExternalStore } from "react";

/** A tiny History-API router (no dependency): /, /agreement, /vault/:address, /attack-lab. */
export function navigate(to: string): void {
  if (location.pathname !== to) history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

const subscribe = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
};

export const usePath = (): string => useSyncExternalStore(subscribe, () => location.pathname);

export type Route =
  | { name: "home" }
  | { name: "agreement" }
  | { name: "vault"; address: string }
  | { name: "lab" }
  | { name: "notfound" };

export function matchRoute(path: string): Route {
  if (path === "/" || path === "") return { name: "home" };
  if (path === "/agreement") return { name: "agreement" };
  if (path === "/attack-lab") return { name: "lab" };
  const v = /^\/vault\/(0x[0-9a-fA-F]{40})$/.exec(path);
  if (v) return { name: "vault", address: v[1] };
  return { name: "notfound" };
}
