import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  GateError,
  agreementHash,
  assertConfirmable,
  canonicalJSON,
  checkGate,
  proposedChecklistSchema,
  resolutionSchema,
  textHash,
  validate,
  normalizeSourceText,
} from "@mv/shared";
import { configFromEnv, extract, providerStatus, type AiConfig } from "./ai";
import type { FetchLike } from "./ai/ollama";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface AppOptions {
  fetchImpl?: FetchLike;
  config?: AiConfig;
  dataDir?: string;
  samplesDir?: string;
  now?: () => Date;
}

const modeSchema = z.enum(["auto", "ollama", "gemini", "rules"]);
const MAX_TEXT = 100_000;
const MAX_NOTE = 5_000;
const MAX_NOTES = 500;

const extractBody = z.object({ text: z.string().min(1).max(MAX_TEXT), mode: modeSchema.default("auto") });
const validateBody = z.object({
  checklist: proposedChecklistSchema,
  sourceText: z.string().max(MAX_TEXT),
  mode: z.enum(["proposal", "edited"]).default("edited"),
});
const confirmBody = z.object({
  proposed: proposedChecklistSchema,
  edited: proposedChecklistSchema,
  sourceText: z.string().min(1).max(MAX_TEXT),
  resolutions: z.array(resolutionSchema),
  addresses: z.object({ client: z.string(), provider: z.string(), arbiter: z.string() }),
  reviewWindowSeconds: z.number(),
  extraction: z.object({ source: z.enum(["ollama", "gemini", "rules"]), model: z.string().nullable() }),
});

const HASH_RE = /^0x[0-9a-f]{64}$/;
const noteBody = z.object({ hash: z.string().regex(HASH_RE), text: z.string().min(1).max(MAX_NOTE) });

/**
 * HARD RULE: this server NEVER touches the chain. There is no route or function here that sends a transaction,
 * holds a key or talks to an RPC node. It extracts, validates, gates and stores the confirmed JSON. Nothing more.
 */
export function createApp(options: AppOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = options.config ?? configFromEnv(process.env);
  const dataDir = options.dataDir ?? path.join(ROOT, "server", "data", "agreements");
  const samplesDir = options.samplesDir ?? path.join(ROOT, "samples", "agreements");
  const now = options.now ?? (() => new Date());
  const deps = { fetchImpl, config };

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  const parse = <T extends z.ZodTypeAny>(schema: T, body: unknown, res: Response): z.infer<T> | null => {
    const r = schema.safeParse(body);
    if (r.success) return r.data;
    res.status(400).json({ error: "Invalid request body", issues: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) });
    return null;
  };

  const wrap =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).catch(next);

  app.get("/api/health", wrap(async (_req, res) => {
    const status = await providerStatus(deps);
    res.json({ ok: true, providers: { ollama: status.ollama, gemini: status.gemini, rules: true }, models: status.models });
  }));

  app.post("/api/extract", wrap(async (req, res) => {
    const body = parse(extractBody, req.body, res);
    if (!body) return;
    res.json(await extract(body.text, body.mode, deps));
  }));

  app.post("/api/validate", (req, res) => {
    const body = parse(validateBody, req.body, res);
    if (!body) return;
    res.json(validate(body.checklist, normalizeSourceText(body.sourceText), body.mode));
  });

  // Dry run of the confirmation gate: what is still unresolved? (keeps the web's Confirm button honest)
  app.post("/api/gate-check", (req, res) => {
    const body = parse(confirmBody, req.body, res);
    if (!body) return;
    res.json(checkGate({ ...body, confirmedAt: now().toISOString() }));
  });

  app.post("/api/confirm", (req, res) => {
    const body = parse(confirmBody, req.body, res);
    if (!body) return;
    try {
      const confirmed = assertConfirmable({ ...body, confirmedAt: now().toISOString() });
      // The server computes the hash itself; it never accepts one from the client.
      const hash = agreementHash(confirmed);
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(path.join(dataDir, `${hash}.json`), JSON.stringify(confirmed, null, 2) + "\n");
      res.json({ confirmed, agreementHash: hash, canonical: canonicalJSON(confirmed) });
    } catch (e) {
      if (e instanceof GateError) {
        res.status(422).json({ error: "The checklist cannot be confirmed yet", errors: e.errors });
        return;
      }
      throw e;
    }
  });

  app.get("/api/agreements/:hash", (req, res) => {
    const { hash } = req.params;
    if (!HASH_RE.test(hash)) {
      res.status(400).json({ error: "hash must be 0x followed by 64 lowercase hex characters" });
      return;
    }
    try {
      res.json(JSON.parse(readFileSync(path.join(dataDir, `${hash}.json`), "utf8")));
    } catch {
      res.status(404).json({ error: "No stored agreement with that hash" });
    }
  });

  // Evidence and rationale texts: the chain stores only their hash, so the readable text lives here (in memory, demo only).
  // A note is accepted only if keccak256(text) equals the hash it is filed under, so nobody can attach a different text to a hash.
  const notes = new Map<string, string>();
  app.post("/api/notes", (req, res) => {
    const body = parse(noteBody, req.body, res);
    if (!body) return;
    if (textHash(body.text) !== body.hash) {
      res.status(422).json({ error: "The text does not hash to the given hash" });
      return;
    }
    if (!notes.has(body.hash) && notes.size >= MAX_NOTES) notes.delete(notes.keys().next().value as string);
    notes.set(body.hash, body.text);
    res.status(201).json({ hash: body.hash });
  });
  app.get("/api/notes/:hash", (req, res) => {
    const text = HASH_RE.test(req.params.hash) ? notes.get(req.params.hash) : undefined;
    if (text === undefined) res.status(404).json({ error: "No stored note with that hash" });
    else res.json({ hash: req.params.hash, text });
  });

  app.get("/api/samples", (_req, res) => {
    let names: string[] = [];
    try {
      names = readdirSync(samplesDir).filter((f) => f.endsWith(".txt")).sort();
    } catch {
      /* no samples directory yet */
    }
    res.json(names.map((name) => ({ name, text: normalizeSourceText(readFileSync(path.join(samplesDir, name), "utf8")) })));
  });

  // Anything unexpected becomes a clean 500, never a stack trace.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  });

  return app;
}
