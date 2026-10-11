import { describe, expect, it } from "vitest";
import { AbiCoder, ErrorFragment, Interface } from "ethers";
import { MilestoneVault } from "../generated/contracts";
import { decodeRevert, findRevertData, formatRawError, makeInterface } from "./revert";
import { formatWei, explainRevert } from "../ui/copy";

const iface = makeInterface([MilestoneVault.abi]);
const vault = new Interface(MilestoneVault.abi);
const coder = AbiCoder.defaultAbiCoder();

const encode = (name: string, args: unknown[] = []) => vault.encodeErrorResult(name, args);

describe("findRevertData: the shapes ethers v6 and JSON-RPC really produce (captured against a live hardhat node)", () => {
  const data = encode("NotClient");
  it("reads err.data (CALL_EXCEPTION from estimateGas)", () => {
    expect(findRevertData({ code: "CALL_EXCEPTION", data, transaction: { to: "0x1", data: "0xdeadbeefdeadbeef" } })).toBe(data);
  });
  it("reads err.error.data and err.info.error.data (wrapped JSON-RPC errors)", () => {
    expect(findRevertData({ error: { code: 3, data } })).toBe(data);
    expect(findRevertData({ info: { error: { data } } })).toBe(data);
    expect(findRevertData({ error: { error: { data: { data } } } })).toBe(data);
  });
  it("NEVER mistakes the transaction's calldata for revert data", () => {
    expect(findRevertData({ transaction: { data: "0x095ea7b30000" }, message: "x" })).toBeNull();
  });
  it("returns null for a network failure (so the UI never claims 'Nothing changed')", () => {
    expect(findRevertData(new Error("connect ECONNREFUSED 127.0.0.1:9"))).toBeNull();
    const d = decodeRevert(new Error("connect ECONNREFUSED 127.0.0.1:9"), iface);
    expect(d.reverted).toBe(false);
  });
});

describe("decodeRevert", () => {
  it("decodes custom errors with their args and the plain-English copy", () => {
    const d = decodeRevert({ data: encode("InvalidMilestoneState", [0, 3]) }, iface);
    expect(d.reverted && d.name).toBe("InvalidMilestoneState");
    if (d.reverted) {
      expect(d.title).toBe("That step isn't allowed now");
      expect(d.detail).toBe("Milestone 1 is released. It is already settled and can't change.");
      expect(d.args.index).toBe(0n);
    }
  });

  it("DeliverableHashMismatch names both hashes", () => {
    const a = "0x" + "11".repeat(32);
    const b = "0x" + "22".repeat(32);
    const d = decodeRevert({ data: encode("DeliverableHashMismatch", [a, b]) }, iface);
    expect(d.reverted && d.title).toBe("This isn't the file that was submitted");
    expect(d.reverted && d.detail).toContain("0x1111…1111");
    expect(d.reverted && d.detail).toContain("0x2222…2222");
  });

  it("decodes Error(string) and Panic(uint256) too (for the naive contract and for bugs)", () => {
    const err = "0x08c379a0" + coder.encode(["string"], ["nothing to withdraw"]).slice(2);
    expect(decodeRevert({ data: err }, iface)).toMatchObject({ reverted: true, name: "Error", detail: "nothing to withdraw" });
    const panic = "0x4e487b71" + coder.encode(["uint256"], [0x11]).slice(2);
    expect(decodeRevert({ data: panic }, iface)).toMatchObject({ reverted: true, name: "Panic" });
  });

  it("falls back to UnknownRevert for a selector it does not know, still without crashing", () => {
    expect(decodeRevert({ data: "0xdeadbeef" }, iface)).toMatchObject({ reverted: true, name: "UnknownRevert" });
  });

  it("includes the role in NotClient's detail", () => {
    const d = decodeRevert({ data: encode("NotClient") }, iface, { role: "KrishiLens team" });
    expect(d.reverted && d.detail).toContain("KrishiLens team");
  });
});

describe("copy", () => {
  it("formats wei exactly, with no floats", () => {
    expect(formatWei(1_000_000_000_000_000_000n)).toBe("1.000");
    expect(formatWei(2_500_000_000_000_000_000n)).toBe("2.500");
    expect(formatWei(1n)).toBe("0.000");
    expect(formatWei(999_500_000_000_000_000n)).toBe("1.000");
    expect(formatWei(123_456_789_012_345_678_901n, 3)).toBe("123.457");
  });
  it("covers every contract error with a title (none falls through to the generic message)", () => {
    const names = vault.fragments.filter((f): f is ErrorFragment => f instanceof ErrorFragment).map((f) => f.name);
    for (const n of names) expect(explainRevert(n, { actual: 0, index: 0, expectedIndex: 0, expected: 0n, sent: 0n, escalationAllowedAt: 0n }).title, n).not.toBe("The contract refused this");
  });
});

describe("formatRawError names the states the chain only sends as numbers", () => {
  const d = (name: string, args: Record<string, unknown>) => ({ name, args, raw: "0x", title: "", detail: "", reverted: true as const });
  it("reads actual: 3 as Released for InvalidMilestoneState and actual: 2 as Active for WrongAgreementState", () => {
    expect(formatRawError(d("InvalidMilestoneState", { index: 0n, actual: 3n }))).toBe("InvalidMilestoneState(index: 0, actual: Released)");
    expect(formatRawError(d("WrongAgreementState", { actual: 2n }))).toBe("WrongAgreementState(actual: Active)");
  });
  it("leaves every other number alone", () => {
    expect(formatRawError(d("MilestoneOutOfOrder", { index: 1n, expectedIndex: 0n }))).toBe("MilestoneOutOfOrder(index: 1, expectedIndex: 0)");
    expect(formatRawError(d("InvalidMilestoneState", { index: 0n, actual: 9n }))).toBe("InvalidMilestoneState(index: 0, actual: 9)");
  });
});
