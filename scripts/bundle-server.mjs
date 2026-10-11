// Bundles the Express server into ONE file for Vercel (server/dist/index.mjs).
// Why: the server imports @mv/shared, a TypeScript-only workspace package, and uses extensionless relative imports. Vercel's own
// TypeScript handling does not load either reliably (`vercel dev` fails with "@mv/shared does not provide an export named ..."),
// so everything is compiled up front. The sample agreements are embedded too: a deployed function has no repo checkout to read.
import { build } from "esbuild";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const samplesDir = path.join(root, "samples", "agreements");
const samples = readdirSync(samplesDir)
  .filter((f) => f.endsWith(".txt"))
  .sort()
  .map((name) => ({ name, text: readFileSync(path.join(samplesDir, name), "utf8") }));

await build({
  entryPoints: [path.join(root, "server", "src", "index.ts")],
  outfile: path.join(root, "server", "dist", "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Some bundled CommonJS dependencies (express and friends) call require(); give the ESM output one.
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  define: { __EMBEDDED_SAMPLES__: JSON.stringify(samples) },
  logLevel: "info",
});
console.log(`bundle-server: wrote server/dist/index.mjs (${samples.length} sample agreement(s) embedded)`);
