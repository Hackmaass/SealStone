import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agreementHash, confirmedChecklistSchema } from "@mv/shared";
import { checkTerms } from "./terms";

const sample = JSON.parse(readFileSync(new URL("../../../samples/krishilens.confirmed.json", import.meta.url), "utf8")) as unknown;
const onChain = agreementHash(confirmedChecklistSchema.parse(sample));

describe("checkTerms (the browser re-hashes; it never trusts a stored copy)", () => {
  it("verifies terms that re-hash to the on-chain seal", () => {
    const r = checkTerms(sample, onChain, "server");
    expect(r.kind).toBe("verified");
    // case of the on-chain hash is irrelevant
    expect(checkTerms(sample, onChain.toUpperCase().replace("0X", "0x"), "server").kind).toBe("verified");
  });

  it("reports a mismatch, with the recomputed hash, when one character of the terms changes", () => {
    const edited = JSON.parse(JSON.stringify(sample).replace("Problem validation report", "Problem validation reporT"));
    const r = checkTerms(edited, onChain, "text");
    expect(r.kind).toBe("mismatch");
    if (r.kind === "mismatch") {
      expect(r.computed).not.toBe(onChain);
      expect(r.computed).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("calls anything that is not a valid confirmed checklist invalid, rather than hashing it", () => {
    expect(checkTerms({ title: "nope" }, onChain, "file").kind).toBe("invalid");
    expect(checkTerms(null, onChain, "file").kind).toBe("invalid");
    const extra = { ...(sample as object), sneaky: true };
    expect(checkTerms(extra, onChain, "file").kind).toBe("invalid");
  });
});
