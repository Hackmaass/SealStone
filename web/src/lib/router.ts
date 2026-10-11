import { useSyncExternalStore } from "react";

/** A tiny History-API router (no dependency). */
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
  | { name: "landing" }
  | { name: "dashboard" }
  | { name: "vaults" }
  | { name: "agreement" }
  | { name: "vault"; address: string }
  | { name: "lab" }
  | { name: "notfound" };

export function matchRoute(path: string): Route {
  if (path === "/" || path === "") return { name: "landing" };
  if (path === "/dashboard") return { name: "dashboard" };
  if (path === "/vaults") return { name: "vaults" };
  if (path === "/agreement") return { name: "agreement" };
  if (path === "/attack-lab") return { name: "lab" };
  const v = /^\/vault\/(0x[0-9a-fA-F]{40})$/.exec(path);
  if (v) return { name: "vault", address: v[1] };
  return { name: "notfound" };
}

/** Plain <a> clicks inside the app should not reload the page. Use as onClick on internal links. */
export function link(to: string) {
  return (e: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean; button?: number }) => {
    if (e.metaKey || e.ctrlKey || (e.button ?? 0) !== 0) return;
    e.preventDefault();
    navigate(to);
  };
}
