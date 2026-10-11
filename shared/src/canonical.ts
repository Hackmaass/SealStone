/**
 * Canonical JSON: the ONE implementation (CLAUDE.md). Keys sorted recursively, array order kept, no whitespace.
 * Strings are escaped exactly as JSON.stringify does and are UTF-8 encoded by the caller when hashing.
 *
 * Deliberately strict, because the output is hashed: anything that JSON.stringify would silently drop or
 * coerce (undefined, functions, NaN, Infinity, symbols, Dates, Maps...) throws instead. bigint also throws:
 * amounts must be converted to decimal strings before calling.
 */
export function canonicalJSON(value: unknown): string {
  return encode(value, "$");
}

function encode(v: unknown, path: string): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "string":
      return JSON.stringify(v);
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new Error(`canonicalJSON: non-finite number at ${path}`);
      return JSON.stringify(v);
    case "bigint":
      throw new Error(`canonicalJSON: bigint at ${path}; convert amounts to decimal strings first`);
    case "undefined":
      throw new Error(`canonicalJSON: undefined at ${path}`);
    case "function":
    case "symbol":
      throw new Error(`canonicalJSON: ${typeof v} at ${path}`);
    default:
      break;
  }
  if (Array.isArray(v)) {
    return `[${v.map((item, i) => encode(item, `${path}[${i}]`)).join(",")}]`;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`canonicalJSON: non-plain object at ${path}`);
  }
  const obj = v as Record<string, unknown>;
  // Default sort compares UTF-16 code units: identical in every JS engine (never use localeCompare here).
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${encode(obj[k], `${path}.${k}`)}`).join(",")}}`;
}
