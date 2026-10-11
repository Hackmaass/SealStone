import { z } from "zod";
import { getAddress } from "ethers";

/**
 * ConfirmedChecklist: the ONLY thing that can reach the chain (docs/05-AI-SPEC.md).
 *
 * Every object is `.strict()` and every field has exactly one canonical spelling, so that
 * "hash the JSON file" and "hash the parsed object" always agree:
 *  - amountWei is a positive decimal integer without leading zeros
 *  - addresses are EIP-55 checksummed
 *  - hashes are lowercase 0x + 64 hex
 */

const checksummedAddress = z.string().refine(
  (a) => {
    try {
      return getAddress(a) === a;
    } catch {
      return false;
    }
  },
  { message: "must be an EIP-55 checksummed address" },
);

const hash32 = z.string().regex(/^0x[0-9a-f]{64}$/, "must be 0x + 64 lowercase hex characters");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, "must be a real calendar date");

export const deliverableTypeSchema = z.enum(["document", "code", "other"]);
export type DeliverableType = z.infer<typeof deliverableTypeSchema>;

export const resolutionSchema = z
  .object({
    ambiguityId: z.string().min(1),
    action: z.enum(["edited", "acknowledged", "clause-removed"]),
    note: z.string().min(5),
    resolvedBy: z.enum(["client", "provider"]),
  })
  .strict();
export type Resolution = z.infer<typeof resolutionSchema>;

const partySchema = z.object({ name: z.string().min(1), address: checksummedAddress }).strict();

const milestoneSchema = z
  .object({
    index: z.number().int().min(0),
    title: z.string().min(1),
    amountWei: z.string().regex(/^[1-9][0-9]*$/, "must be a positive decimal integer without leading zeros"),
    conditions: z.array(z.string().min(1)).min(1),
    deadline: isoDate.nullable(),
    deliverableType: deliverableTypeSchema,
  })
  .strict();

export const confirmedChecklistSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().min(1),
    parties: z.object({ client: partySchema, provider: partySchema, arbiter: partySchema }).strict(),
    milestones: z.array(milestoneSchema).min(1).max(20),
    reviewWindowSeconds: z.number().int().positive(),
    resolutions: z.array(resolutionSchema),
    extraction: z
      .object({
        source: z.enum(["ollama", "gemini", "rules"]),
        model: z.string().nullable(),
        sourceTextHash: hash32,
      })
      .strict(),
    confirmedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((c, ctx) => {
    c.milestones.forEach((m, i) => {
      if (m.index !== i) {
        ctx.addIssue({ code: "custom", path: ["milestones", i, "index"], message: `index must equal its position (${i})` });
      }
    });
    const { client, provider, arbiter } = c.parties;
    const addrs = [client.address, provider.address, arbiter.address].map((a) => a.toLowerCase());
    if (new Set(addrs).size !== 3) {
      ctx.addIssue({ code: "custom", path: ["parties"], message: "client, provider and arbiter addresses must be distinct" });
    }
  });

export type ConfirmedChecklist = z.infer<typeof confirmedChecklistSchema>;
