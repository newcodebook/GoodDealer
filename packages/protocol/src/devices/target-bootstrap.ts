import { z } from "zod";
import { identifier } from "../wire/index";
import { deviceSwitchRequestViewSchema } from "./device-management";

/** A null identifier discovers only the authenticated device's own pending bootstrap. */
export const deviceBootstrapStatusRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: identifier.nullable(),
  })
  .strict();
export const deviceBootstrapStatusResponseSchema = z.discriminatedUnion("found", [
  z.object({ schemaVersion: z.literal(1), found: z.literal(false) }).strict(),
  z
    .object({ schemaVersion: z.literal(1), found: z.literal(true), request: deviceSwitchRequestViewSchema })
    .strict(),
]);
export type DeviceBootstrapStatusRequest = z.infer<typeof deviceBootstrapStatusRequestSchema>;
export type DeviceBootstrapStatusResponse = z.infer<typeof deviceBootstrapStatusResponseSchema>;
