import { z } from "zod";

export const ACCOUNT_ACTIVATION_SCHEMA_VERSION = 1 as const;
export const ACCOUNT_ACTIVATION_OPERATION_ID = "account.activation.activate" as const;

/** The authenticated server session is the only activation identity source. */
export const accountActivationRequestSchema = z
  .object({ schemaVersion: z.literal(ACCOUNT_ACTIVATION_SCHEMA_VERSION) })
  .strict();

export const accountActivationResponseSchema = z
  .object({
    schemaVersion: z.literal(ACCOUNT_ACTIVATION_SCHEMA_VERSION),
    state: z.literal("active"),
  })
  .strict();

export type AccountActivationRequest = z.infer<typeof accountActivationRequestSchema>;
export type AccountActivationResponse = z.infer<typeof accountActivationResponseSchema>;
