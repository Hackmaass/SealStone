import { useCallback, useState } from "react";
import { explain } from "./chain";
import { WalletError, explainWalletError } from "./wallet";
import type { DecodedRevert } from "./revert";
import { useToast } from "../ui/toast";

/**
 * Runs a transaction, locks the button while pending, and turns a revert into the plain-English notice.
 * `onRejected` is the one hook point for "a refusal happened": the vault screen records it for the timeline.
 */
export function useTx(role: string, onRejected?: (d: DecodedRevert, label: string) => void) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<DecodedRevert | null>(null);
  const run = useCallback(
    async (label: string, fn: () => Promise<void>): Promise<boolean> => {
      setBusy(label);
      setNotice(null);
      try {
        await fn();
        return true;
      } catch (e) {
        // The wallet said no (the person closed the pop-up, or it is on the wrong account or network): nothing was sent.
        const code = (e as { code?: number | string; info?: { error?: { code?: number } } }).info?.error?.code ?? (e as { code?: number | string }).code;
        if (e instanceof WalletError || code === 4001 || code === "ACTION_REJECTED") {
          toast(<>{explainWalletError(e)}</>, true);
          return false;
        }
        const d = explain(e, role);
        if (d.reverted) {
          setNotice(d);
          onRejected?.(d, label);
          toast(
            <>
              <b>{d.title}.</b> Nothing changed.
            </>,
            true,
          );
        } else {
          // A timeout or network failure may still have been mined, so never claim "Nothing changed" here.
          toast(<>That didn't complete: {d.message.slice(0, 140)}. Check the vault before trying again.</>, true);
        }
        return false;
      } finally {
        setBusy(null);
      }
    },
    [role, toast, onRejected],
  );
  return { busy, notice, run, setNotice };
}
