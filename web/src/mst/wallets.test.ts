import { describe, expect, it } from "vitest";
import { scanInjected } from "./wallets";

const fake = (extra: object = {}) => ({ request: async () => null, ...extra });

describe("wallet scan", () => {
  it("finds window.ethereum", () => {
    const eth = fake({ isMetaMask: true });
    expect(scanInjected({ ethereum: eth }).map((w) => w.provider)).toEqual([eth]);
  });
  it("finds every wallet in window.ethereum.providers", () => {
    const a = fake({ isMetaMask: true });
    const b = fake({ isBridgeKey: true });
    const found = scanInjected({ ethereum: fake({ providers: [a, b] }) });
    expect(found.map((w) => w.provider)).toContain(b);
    expect(found.some((w) => /BridgeKey/.test(w.name))).toBe(true);
  });
  it("finds a wallet injected under its own name, once", () => {
    const p = fake();
    const found = scanInjected({ bridgekey: p, bridgekeyAlias: { ethereum: p } });
    expect(found).toHaveLength(1);
    expect(found[0].name).toMatch(/bridgekey/i);
  });
  it("ignores unrelated or non-provider properties and finds nothing on an empty page", () => {
    expect(scanInjected({ walletConfig: { a: 1 }, document: {}, foo: fake() })).toEqual([]);
  });
});
