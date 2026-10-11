import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.SERVER_PORT ?? 8787);
app.listen(port, "127.0.0.1", () => {
  console.log(`MilestoneVault server listening on http://127.0.0.1:${port}`);
});
