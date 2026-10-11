// HARD RULE: this server NEVER touches the chain. It has no wallet, no private key, no RPC client and no route that
// sends a transaction. It extracts, validates, gates and stores the confirmed agreement JSON. The browser deploys.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";

// .env lives at the repo root, not in server/ (npm runs this from server/). createApp() reads the environment, so this
// runs first. On Vercel there is no such file (the project's environment variables are already set), which is fine.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const app = createApp();

// On Vercel the platform owns the socket and calls the exported app per request. Locally we listen on loopback only.
if (!process.env.VERCEL) {
  const port = Number(process.env.SERVER_PORT ?? 8787);
  app.listen(port, "127.0.0.1", () => {
    console.log(`Sealstone server listening on http://127.0.0.1:${port}`);
  });
}

export default app;
