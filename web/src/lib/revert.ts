import { AbiCoder, Interface, type InterfaceAbi } from "ethers";
import { explainRevert } from "../ui/copy";

/**
 * Turning a failed transaction into a plain-English refusal.
 * The revert data is found by walking only the keys that can hold it (never `transaction`, whose `data` is the CALLDATA).
 */

export interface DecodedRevert {
  /** Custom error name (or "Error"/"Panic"/"UnknownRevert"). */
  name: string;
  args: Record<string, unknown>;
  /** Raw revert data, e.g. 0x7c9a1cf9… */
  raw: string;
  title: string;
  detail: string;
  /** A real contract revert was decoded: the transaction did not change any state. */
  reverted: true;
}

export interface NotARevert {
  reverted: false;
  /** e.g. a timeout or a network failure: the transaction MAY have been mined, so never claim "Nothing changed". */
  message: string;
}

const HEX = /^0x[0-9a-fA-F]*$/;
const KEYS = ["data", "error", "info", "cause", "revert"] as const;

/** Depth-limited search for revert data inside an ethers/JSON-RPC error. */
export function findRevertData(err: unknown, depth = 0): string | null {
  if (err === null || typeof err !== "object" || depth > 6) return null;
  const obj = err as Record<string, unknown>;
  for (const k of KEYS) {
    const v = obj[k];
    if (typeof v === "string" && HEX.test(v) && v.length >= 10 && v.length % 2 === 0 && k === "data") return v;
    if (v && typeof v === "object") {
      const found = findRevertData(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function makeInterface(abis: InterfaceAbi[]): Interface {
  // Merge fragments from several ABIs (vault, attackers...). De-duplicate by signature so Interface does not complain.
  const seen = new Set<string>();
  const fragments: unknown[] = [];
  for (const abi of abis) {
    for (const f of Interface.from(abi).fragments) {
      if (f.type === "constructor") continue;
      const json = f.format("json");
      if (!seen.has(json)) {
        seen.add(json);
        fragments.push(json);
      }
    }
  }
  return new Interface(fragments.map((f) => JSON.parse(f as string)));
}

const ERROR_SELECTOR = "0x08c379a0"; // Error(string)
const PANIC_SELECTOR = "0x4e487b71"; // Panic(uint256)

export function decodeRevertData(data: string, iface: Interface, ctx: { role?: string } = {}): DecodedRevert {
  const coder = AbiCoder.defaultAbiCoder();
  let name = "UnknownRevert";
  let args: Record<string, unknown> = {};
  try {
    if (data.startsWith(ERROR_SELECTOR)) {
      name = "Error";
      args = { message: coder.decode(["string"], "0x" + data.slice(10))[0] as string };
    } else if (data.startsWith(PANIC_SELECTOR)) {
      name = "Panic";
      args = { code: coder.decode(["uint256"], "0x" + data.slice(10))[0] as bigint };
    } else {
      const parsed = iface.parseError(data);
      if (parsed) {
        name = parsed.name;
        args = Object.fromEntries(parsed.fragment.inputs.map((input, i) => [input.name || String(i), parsed.args[i]]));
      }
    }
  } catch {
    /* keep UnknownRevert */
  }
  const text = explainRevert(name, args, ctx);
  const detail = name === "Error" ? String(args.message) : name === "Panic" ? `Panic code ${String(args.code)}` : text.detail;
  const title = name === "Error" ? "The contract refused this" : name === "Panic" ? "The contract hit an internal error" : text.title;
  return { name, args, raw: data, title, detail, reverted: true };
}

export function decodeRevert(err: unknown, iface: Interface, ctx: { role?: string } = {}): DecodedRevert | NotARevert {
  const data = findRevertData(err);
  if (data) return decodeRevertData(data, iface, ctx);
  const message = err instanceof Error ? err.message : String(err);
  return { reverted: false, message };
}

/** The "args" part of a raw error line: Name(index: 0, actual: Released). Used under the plain-English line. */
export function formatRawError(d: DecodedRevert): string {
  const parts = Object.entries(d.args).map(([k, v]) => `${k}: ${typeof v === "bigint" ? v.toString() : String(v)}`);
  return `${d.name}(${parts.join(", ")})`;
}
