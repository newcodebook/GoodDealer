import { z } from "zod";

export const WIRE_SCHEMA_VERSION = 1 as const;

const requestDataSchema = z
  .object({
    operation: z.string().min(1),
    payload: z.unknown(),
  })
  .strict();

const successDataSchema = z
  .object({
    payload: z.unknown(),
  })
  .strict();

const errorDataSchema = z
  .object({
    code: z.enum(["INVALID_REQUEST", "UNSUPPORTED_VERSION", "INTERNAL"]),
    message: z.string().min(1),
    retryable: z.boolean(),
  })
  .strict();

const bodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("request"), data: requestDataSchema }).strict(),
  z.object({ type: z.literal("success"), data: successDataSchema }).strict(),
  z.object({ type: z.literal("error"), data: errorDataSchema }).strict(),
]);

export const wireEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(WIRE_SCHEMA_VERSION),
    messageId: z.string().min(1),
    body: bodySchema,
  })
  .strict();

export type WireEnvelope = z.infer<typeof wireEnvelopeSchema>;
