import { z } from "zod";

/** Host-produced evidence of one development run; never an input or a production qualification. */
export const afternicControlledAcceptanceSchema = z.object({
  runId: z.literal("afternic-wecin-linux-20261119"),
  domain: z.literal("wecin.com"),
  expiresAt: z.literal("2026-11-26T23:59:59Z"),
  connectionId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u).nullable(),
}).strict();

export type AfternicControlledAcceptance = z.infer<typeof afternicControlledAcceptanceSchema>;
