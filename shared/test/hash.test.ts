import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256, toUtf8Bytes, keccak256 } from "ethers";
import { agreementHash, canonicalJSON, confirmedChecklistSchema, fileSha256, textHash } from "../src/index";

const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const vector = read("./vector.json") as { checklist: any; canonical: string; hash: string };
const krishilens = read("../../samples/krishilens.confirmed.json");

describe("canonicalJSON", () => {
  it("sorts keys recursively, keeps array order and emits no whitespace", () => {
    expect(canonicalJSON({ b: 1, a: { d: [3, 1, 2], c: null }, "": true })).toBe('{"":true,"a":{"c":null,"d":[3,1,2]},"b":1}');
  });

  it("sorts by UTF-16 code unit, never by locale", () => {
    expect(canonicalJSON({ b: 1, a: 1, B: 1, é: 1, Z: 1 })).toBe('{"B":1,"Z":1,"a":1,"b":1,"é":1}');
  });

  it("does not escape non-ASCII characters (they are UTF-8 encoded when hashed)", () => {
    expect(canonicalJSON({ s: "₹ — é" })).toBe('{"s":"₹ — é"}');
  });

  it.each([
    ["undefined", undefined],
    ["undefined inside an object", { a: undefined }],
    ["undefined inside an array", [1, undefined]],
    ["a function", () => 1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a bigint", 10n],
    ["a nested bigint", { amount: 10n }],
    ["a symbol", Symbol("x")],
    ["a Date", new Date(0)],
    ["a Map", new Map()],
  ])("rejects %s", (_name, value) => {
    expect(() => canonicalJSON(value)).toThrow(/canonicalJSON/);
  });
});

describe("agreement hash vector (frozen)", () => {
  it("produces the frozen canonical string", () => {
    expect(canonicalJSON(confirmedChecklistSchema.parse(vector.checklist))).toBe(vector.canonical);
  });

  it("produces the frozen keccak256 agreement hash", () => {
    expect(agreementHash(vector.checklist)).toBe(vector.hash);
    expect(vector.hash).toBe(keccak256(toUtf8Bytes(vector.canonical)));
  });

  it("does not depend on the key order of the input", () => {
    const reversed = JSON.parse(JSON.stringify(vector.checklist, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)));
    expect(Object.keys(reversed)).not.toEqual(Object.keys(vector.checklist));
    expect(agreementHash(reversed)).toBe(vector.hash);
  });

  it("changes when a single character of any field changes", () => {
    const edited = structuredClone(vector.checklist);
    edited.milestones[0].amountWei = "1000000000000000001";
    expect(agreementHash(edited)).not.toBe(vector.hash);
  });
});

describe("ConfirmedChecklist schema (one canonical form per value)", () => {
  const edit = (fn: (c: any) => void) => {
    const c = structuredClone(krishilens);
    fn(c);
    return confirmedChecklistSchema.safeParse(c).success;
  };

  it("accepts the KrishiLens sample and its amounts add up to 5 ETH", () => {
    expect(confirmedChecklistSchema.safeParse(krishilens).success).toBe(true);
    const total = krishilens.milestones.reduce((a: bigint, m: any) => a + BigInt(m.amountWei), 0n);
    expect(total).toBe(5000000000000000000n);
  });

  it("rejects unknown keys (strict objects)", () => {
    expect(edit((c) => (c.extra = 1))).toBe(false);
    expect(edit((c) => (c.milestones[0].extra = 1))).toBe(false);
    expect(edit((c) => (c.parties.client.extra = 1))).toBe(false);
  });

  it("rejects non-canonical amounts (leading zeros, zero, decimals, negatives)", () => {
    for (const bad of ["01000", "0", "1.5", "-5", "1e18", ""]) {
      expect(edit((c) => (c.milestones[0].amountWei = bad)), bad).toBe(false);
    }
  });

  it("rejects non-checksummed addresses", () => {
    expect(edit((c) => (c.parties.client.address = c.parties.client.address.toLowerCase()))).toBe(false);
  });

  it("rejects duplicate party addresses", () => {
    expect(edit((c) => (c.parties.arbiter.address = c.parties.client.address))).toBe(false);
  });

  it("rejects an index that is not its position, 0 and 21 milestones, and a bad review window", () => {
    expect(edit((c) => (c.milestones[1].index = 5))).toBe(false);
    expect(edit((c) => (c.milestones = []))).toBe(false);
    expect(edit((c) => (c.milestones = Array.from({ length: 21 }, (_, i) => ({ ...c.milestones[0], index: i }))))).toBe(false);
    expect(edit((c) => (c.reviewWindowSeconds = 0))).toBe(false);
    expect(edit((c) => (c.reviewWindowSeconds = 1.5))).toBe(false);
  });

  it("rejects bad dates, bad hashes and an empty condition list", () => {
    expect(edit((c) => (c.milestones[0].deadline = "2026-02-30"))).toBe(false);
    expect(edit((c) => (c.milestones[0].deadline = "31/10/2026"))).toBe(false);
    expect(edit((c) => (c.extraction.sourceTextHash = "0x1234"))).toBe(false);
    expect(edit((c) => (c.extraction.sourceTextHash = c.extraction.sourceTextHash.toUpperCase().replace("0X", "0x")))).toBe(false);
    expect(edit((c) => (c.milestones[0].conditions = []))).toBe(false);
  });

  it("refuses to hash an invalid checklist", () => {
    const bad = structuredClone(krishilens);
    bad.milestones[0].amountWei = "01";
    expect(() => agreementHash(bad)).toThrow();
  });
});

describe("hashing helpers", () => {
  it("fileSha256 matches ethers.sha256 (the contract tests and the seed rely on this)", async () => {
    for (const s of ["", "m1-report.pdf (demo)", "₹ — é"]) {
      const bytes = toUtf8Bytes(s);
      expect(await fileSha256(bytes)).toBe(sha256(bytes));
    }
    expect(await fileSha256(new Uint8Array([0, 1, 2, 255]))).toBe(sha256(new Uint8Array([0, 1, 2, 255])));
  });

  it("fileSha256 matches the well-known SHA-256 of 'abc'", async () => {
    expect(await fileSha256(toUtf8Bytes("abc"))).toBe("0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("textHash is keccak256 of the UTF-8 text", () => {
    expect(textHash("")).toBe("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  });

  it("the KrishiLens sample's sourceTextHash is the hash of samples/agreements/krishilens.txt (LF endings)", () => {
    const text = readFileSync(fileURLToPath(new URL("../../samples/agreements/krishilens.txt", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
    expect(textHash(text)).toBe(krishilens.extraction.sourceTextHash);
  });
});
