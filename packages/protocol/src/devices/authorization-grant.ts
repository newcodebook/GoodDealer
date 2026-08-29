import { z } from "zod";

import { identifier } from "../wire/index";
import { activeDeviceLeaseEnvelopeSchema } from "./device-identity";

export const DESKTOP_AUTHORIZATION_GRANT_SCHEMA_VERSION = 1 as const;
export const DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID =
  "devices.authorizationGrant.issue" as const;

/** The authenticated session and bound device are the only request authority sources. */
export const desktopAuthorizationGrantRequestSchema = z
  .object({ schemaVersion: z.literal(DESKTOP_AUTHORIZATION_GRANT_SCHEMA_VERSION) })
  .strict();

/**
 * Cloud-issued authorization input for the first local-business slice. Parsing proves only wire
 * shape; Desktop Host must still verify the ActiveDeviceLease signature and authenticated binding.
 */
export const desktopAuthorizationGrantSchema = z
  .object({
    schemaVersion: z.literal(DESKTOP_AUTHORIZATION_GRANT_SCHEMA_VERSION),
    workspace: z
      .object({
        workspaceId: identifier,
        kind: z.literal("personal_default"),
      })
      .strict(),
    activeDeviceLease: activeDeviceLeaseEnvelopeSchema,
    scopes: z.tuple([z.literal("workspace:mutate"), z.literal("workspace:read")]),
  })
  .strict();

export type DesktopAuthorizationGrantRequest = z.infer<
  typeof desktopAuthorizationGrantRequestSchema
>;
export type DesktopAuthorizationGrant = z.infer<typeof desktopAuthorizationGrantSchema>;
