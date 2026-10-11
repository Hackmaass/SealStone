// Vercel looks for the build output in "dist", but this repo is an npm workspace and Vite writes to web/dist.
// Whatever the project's Root Directory / Output Directory settings are, make the output exist in both places:
// web/dist (already there) and <repo root>/dist (copied here). Run after `npm run build --workspace web`.
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "web", "dist");
const to = path.join(root, "dist");
if (!existsSync(path.join(from, "index.html"))) {
  console.error(`vercel-output: ${from} has no index.html. Did the web build run?`);
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`vercel-output: copied web/dist to dist (${path.relative(process.cwd(), to) || "."})`);
