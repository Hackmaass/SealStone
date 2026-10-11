import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url));
const sha256 = (b: Buffer) => "0x" + createHash("sha256").update(b).digest("hex");

describe("demo deliverables", () => {
  it("ships identical copies in the app (web/public/demo) and the repo samples (samples/demo-files)", () => {
    for (const f of ["m1-report.pdf", "m1-report-v2.pdf"]) {
      expect(read(`../../public/demo/${f}`).equals(read(`../../../samples/demo-files/${f}`)), f).toBe(true);
    }
  });

  it("m1-report.pdf is byte-for-byte what deploy-demo.ts hashes for the seeded milestone 1 ('m1-report.pdf (demo)', no newline)", () => {
    const bytes = read("../../public/demo/m1-report.pdf");
    expect(bytes.toString("utf8")).toBe("m1-report.pdf (demo)");
    // the same expression the deploy script uses: fileSha256(new TextEncoder().encode("m1-report.pdf (demo)"))
    expect(sha256(bytes)).toBe(sha256(Buffer.from(new TextEncoder().encode("m1-report.pdf (demo)"))));
  });

  it("the look-alike v2 file has different contents, so it hashes differently", () => {
    expect(sha256(read("../../public/demo/m1-report-v2.pdf"))).not.toBe(sha256(read("../../public/demo/m1-report.pdf")));
  });
});
