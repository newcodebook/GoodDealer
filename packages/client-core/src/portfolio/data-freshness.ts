import { serverRevisionSchema } from "@gooddealer/protocol/workspace";
import { z } from "zod";

export const portfolioQuerySourceSchema = z.enum(["active_local", "standby_cloud"]);
export const localReadOnlyReasonSchema = z.enum(["commercial", "standby"]).nullable();

export const dataFreshnessSchema = z
  .object({
    source: portfolioQuerySourceSchema,
    readOnlyReason: localReadOnlyReasonSchema.optional(),
    serverRevision: serverRevisionSchema,
    lastReplicationActivityAt: z.iso.datetime().nullable(),
    lastSuccessfulProviderObservationAt: z.iso.datetime().nullable(),
    canEdit: z.boolean(),
  })
  .strict()
  .superRefine((freshness, context) => {
    const expectedCanEdit = freshness.source === "active_local" && (freshness.readOnlyReason ?? null) === null;
    if (freshness.canEdit !== expectedCanEdit) {
      context.addIssue({
        code: "custom",
        path: ["canEdit"],
        message: `${freshness.source} requires canEdit=${expectedCanEdit}`,
      });
    }
  });

export type PortfolioQuerySource = z.infer<typeof portfolioQuerySourceSchema>;
export type DataFreshness = z.infer<typeof dataFreshnessSchema>;
export type LocalReadOnlyReason = z.infer<typeof localReadOnlyReasonSchema>;
