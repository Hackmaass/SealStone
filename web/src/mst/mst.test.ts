import { describe, expect, it } from "vitest";
import { buildChecklist, checkParties, MST } from "./mst";

const A = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const B = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const C = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

describe("MST deploy page", () => {
  it("targets MST testnet and never mainnet", () => {
    expect(MST.chainId).toBe(91562037);
    expect(MST.chainIdHex).toBe("0x" + (91562037).toString(16));
  });
  it("rejects duplicate or invalid parties before any transaction", () => {
    expect(checkParties(A, A, C).ok).toBe(false);
    expect(checkParties(A, B, "nope").ok).toBe(false);
    expect(checkParties("", B, C).ok).toBe(false);
    expect(checkParties(A, B, C).ok).toBe(true);
  });
  it("hashes the checklist with the real parties substituted", () => {
    const one = buildChecklist(A, B, C);
    const two = buildChecklist(A, C, B);
    expect(one.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(one.hash).not.toBe(two.hash);
    expect(one.confirmed.parties.client.address).toBe(A);
  });
});
