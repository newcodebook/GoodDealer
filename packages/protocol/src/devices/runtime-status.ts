import { z } from "zod";

export const RUNTIME_STATUS_SCHEMA_VERSION = 1 as const;

const runtimeModeSchema = z.enum([
  "locked",
  "standby",
  "activating",
  "active",
  "draining",
  "local_continuation",
]);

const activationPurposeSchema = z.enum(["bootstrap", "local_recovery"]);

export const runtimeStatusSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_STATUS_SCHEMA_VERSION),
    mode: runtimeModeSchema,
    activationPurpose: activationPurposeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const purposeMatchesMode =
      value.mode === "activating"
        ? value.activationPurpose !== null
        : value.activationPurpose === null;

    if (!purposeMatchesMode) {
      context.addIssue({
        code: "custom",
        path: ["activationPurpose"],
        message: "activationPurpose is required only while activating",
      });
    }
  });

export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;
