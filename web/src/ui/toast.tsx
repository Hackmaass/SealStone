import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface ToastItem {
  id: number;
  bad: boolean;
  body: ReactNode;
}

interface ToastApi {
  toast: (body: ReactNode, bad?: boolean) => void;
}

const Ctx = createContext<ToastApi>({ toast: () => {} });
export const useToast = (): ToastApi => useContext(Ctx);

let nextId = 1;

/** Success = green rule, revert = red rule. At most two visible (docs/08). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((body: ReactNode, bad = false) => {
    const id = nextId++;
    setItems((cur) => [...cur.slice(-1), { id, bad, body }]);
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), bad ? 6000 : 4200);
  }, []);
  const api = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.bad ? " bad" : ""}`} role={t.bad ? "alert" : "status"}>
            {t.body}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
