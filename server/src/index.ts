// HARD RULE: this server NEVER touches the chain. It has no wallet, no private key, no RPC client and no route that
// sends a transaction. It extracts, validates, gates and stores the confirmed agreement JSON. The browser deploys.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// .env lives at the repo root, not in server/ (npm runs this from server/). Load it before reading any config.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const { createApp } = await import("./app");

const port = Number(process.env.SERVER_PORT ?? 8787);
createApp().listen(port, "127.0.0.1", () => {
  console.log(`MilestoneVault server listening on http://127.0.0.1:${port}`);
});
