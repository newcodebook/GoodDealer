import { z } from "zod";

import { canonicalUtcTimestamp, displayLabel, identifier, safePositiveInteger } from "../wire/index";

export const DEVICE_MANAGEMENT_SCHEMA_VERSION = 1 as const;

export const devicePlatformSchema = z.enum(["windows", "macos", "ios", "android"]);
export const deviceRoleSchema = z.enum(["active", "standby", "none"]);

export const deviceBindingSummarySchema = z
  .object({
    schemaVersion: z.literal(DEVICE_MANAGEMENT_SCHEMA_VERSION),
    deviceId: identifier,
    platform: devicePlatformSchema,
    displayName: displayLabel,
    status: z.enum(["bound", "removed"]),
    role: deviceRoleSchema,
    credentialEpoch: safePositiveInteger,
    signingKeyId: identifier,
    signingKeyVersion: safePositiveInteger,
    signingKeyStatus: z.enum(["active", "rotated", "revoked"]),
    boundAt: canonicalUtcTimestamp,
    lastSeenAt: canonicalUtcTimestamp,
    removedAt: canonicalUtcTimestamp.nullable(),
    currentDevice: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.status === "removed") !== (value.removedAt !== null)) {
      context.addIssue({ code: "custom", path: ["removedAt"], message: "removal timestamp must agree with status" });
    }
    if (value.status === "removed" && (value.role !== "none" || value.currentDevice)) {
      context.addIssue({ code: "custom", path: ["role"], message: "removed devices have no role and cannot be current" });
    }
    if (value.role !== "none" && value.status !== "bound") {
      context.addIssue({ code: "custom", path: ["role"], message: "a role requires a bound device" });
    }
    if (value.boundAt > value.lastSeenAt || (value.removedAt !== null && value.boundAt > value.removedAt)) {
      context.addIssue({ code: "custom", path: ["boundAt"], message: "device timestamps are out of order" });
    }
    if (value.signingKeyStatus === "revoked" && value.role !== "none") {
      context.addIssue({ code: "custom", path: ["signingKeyStatus"], message: "a revoked signing key carries no role" });
    }
  });

export const deviceBindingListSchema = z
  .object({
    schemaVersion: z.literal(DEVICE_MANAGEMENT_SCHEMA_VERSION),
    listRevision: safePositiveInteger,
    devices: z.array(deviceBindingSummarySchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.devices.map(({ deviceId }) => deviceId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: ["devices"], message: "device ids must be unique" });
    }
    if (value.devices.filter(({ status }) => status === "bound").length > 2) {
      context.addIssue({ code: "custom", path: ["devices"], message: "at most two devices may be bound" });
    }
    if (value.devices.filter(({ role }) => role === "active").length > 1) {
      context.addIssue({ code: "custom", path: ["devices"], message: "at most one device may be active" });
    }
    if (value.devices.filter(({ currentDevice }) => currentDevice).length > 1) {
      context.addIssue({ code: "custom", path: ["devices"], message: "at most one device may be current" });
    }
  });

export const activeDeviceLeaseStatusSchema = z
  .object({
    schemaVersion: z.literal(DEVICE_MANAGEMENT_SCHEMA_VERSION),
    held: z.boolean(),
    deviceId: identifier.nullable(),
    leaseEpoch: safePositiveInteger.nullable(),
    issuedAt: canonicalUtcTimestamp.nullable(),
    renewAfter: canonicalUtcTimestamp.nullable(),
    onlineExpiresAt: canonicalUtcTimestamp.nullable(),
    offlineExecuteUntil: canonicalUtcTimestamp.nullable(),
    renewalState: z.enum(["fresh", "renewal_window", "offline_grace", "expired"]),
    evaluatedAt: canonicalUtcTimestamp,
  })
  .strict()
  .superRefine((value, context) => {
    const leaseFields = ["deviceId", "leaseEpoch", "issuedAt", "renewAfter", "onlineExpiresAt", "offlineExecuteUntil"] as const;
    if (!value.held) {
      for (const field of leaseFields) {
        if (value[field] !== null) {
          context.addIssue({ code: "custom", path: [field], message: "an unheld lease has no credential metadata" });
        }
      }
      if (value.renewalState !== "expired") {
        context.addIssue({ code: "custom", path: ["renewalState"], message: "an unheld lease is expired" });
      }
      return;
    }
    for (const field of leaseFields) {
      if (value[field] === null) {
        context.addIssue({ code: "custom", path: [field], message: "a held lease requires complete metadata" });
      }
    }
    if (value.issuedAt === null || value.renewAfter === null || value.onlineExpiresAt === null || value.offlineExecuteUntil === null) {
      return;
    }
    if (!(value.issuedAt < value.renewAfter && value.renewAfter < value.onlineExpiresAt && value.onlineExpiresAt <= value.offlineExecuteUntil)) {
      context.addIssue({ code: "custom", path: ["issuedAt"], message: "lease timestamps are out of order" });
    }
    if (Date.parse(value.offlineExecuteUntil) - Date.parse(value.issuedAt) > 86_400_000) {
      context.addIssue({ code: "custom", path: ["offlineExecuteUntil"], message: "offline execution window exceeds 24 hours" });
    }
    const expectedState =
      value.evaluatedAt < value.renewAfter
        ? "fresh"
        : value.evaluatedAt < value.onlineExpiresAt
          ? "renewal_window"
          : value.evaluatedAt < value.offlineExecuteUntil
            ? "offline_grace"
            : "expired";
    if (value.renewalState !== expectedState) {
      context.addIssue({ code: "custom", path: ["renewalState"], message: "renewal state disagrees with trusted evaluation time" });
    }
  });

export const cloudScopeSchema = z.enum([
  "account:manage",
  "audit-events:ingest",
  "execution-facts:ingest",
  "operation:approve",
  "platform:read",
  "platform:write",
  "recovery-proposals:ingest",
  "workspace:mutate",
  "workspace:read",
]);

export const deviceAuthorityProjectionSchema = z
  .object({
    schemaVersion: z.literal(DEVICE_MANAGEMENT_SCHEMA_VERSION),
    role: deviceRoleSchema,
    scopes: z.array(cloudScopeSchema).max(9),
  })
  .strict()
  .superRefine((value, context) => {
    for (let index = 1; index < value.scopes.length; index += 1) {
      if (value.scopes[index - 1]! >= value.scopes[index]!) {
        context.addIssue({ code: "custom", path: ["scopes"], message: "scopes must be strictly ascending" });
        break;
      }
    }
    if (
      value.role === "standby" &&
      value.scopes.some((scope) => ["workspace:mutate", "platform:read", "platform:write", "operation:approve"].includes(scope))
    ) {
      context.addIssue({ code: "custom", path: ["scopes"], message: "standby scope is read-only" });
    }
    if (value.role === "none" && value.scopes.length !== 0) {
      context.addIssue({ code: "custom", path: ["scopes"], message: "devices with no role receive no scopes" });
    }
  });

export const deviceRemovalRequestSchema = z
  .object({
    schemaVersion: z.literal(DEVICE_MANAGEMENT_SCHEMA_VERSION),
    deviceId: identifier,
    expectedCredentialEpoch: safePositiveInteger,
    expectedListRevision: safePositiveInteger,
    reauthProofId: identifier,
  })
  .strict();

export const deviceSwitchRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    schemaVersion: z.literal(DEVICE_MANAGEMENT_SCHEMA_VERSION),
    mode: z.literal("normal"),
    toDeviceId: identifier,
    idempotencyKey: identifier,
  }).strict(),
  z.object({
    schemaVersion: z.literal(DEVICE_MANAGEMENT_SCHEMA_VERSION),
    mode: z.literal("forced"),
    toDeviceId: identifier,
    idempotencyKey: identifier,
    reauthProofId: identifier,
  }).strict(),
]);

export const deviceSwitchRequestViewSchema = z
  .object({
    schemaVersion: z.literal(DEVICE_MANAGEMENT_SCHEMA_VERSION),
    requestId: identifier,
    mode: z.enum(["normal", "forced"]),
    status: z.enum(["requested", "draining", "waiting_expiry", "bootstrapping", "completed", "cancelled", "failed"]),
    fromDeviceId: identifier.nullable(),
    toDeviceId: identifier,
    requestedAt: canonicalUtcTimestamp,
    earliestTakeoverAt: canonicalUtcTimestamp.nullable(),
    bootstrapExpiresAt: canonicalUtcTimestamp.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "forced" && value.earliestTakeoverAt === null) {
      context.addIssue({ code: "custom", path: ["earliestTakeoverAt"], message: "forced switches require an earliest takeover" });
    }
    if ((value.status === "bootstrapping") !== (value.bootstrapExpiresAt !== null)) {
      context.addIssue({ code: "custom", path: ["bootstrapExpiresAt"], message: "bootstrap expiry must agree with status" });
    }
    if (["completed", "cancelled", "failed"].includes(value.status) && value.bootstrapExpiresAt !== null) {
      context.addIssue({ code: "custom", path: ["bootstrapExpiresAt"], message: "terminal switches have no bootstrap expiry" });
    }
    if (value.earliestTakeoverAt !== null && value.requestedAt > value.earliestTakeoverAt) {
      context.addIssue({ code: "custom", path: ["earliestTakeoverAt"], message: "takeover cannot precede the request" });
    }
  });

export type DevicePlatform = z.infer<typeof devicePlatformSchema>;
export type DeviceRole = z.infer<typeof deviceRoleSchema>;
export type DeviceBindingSummary = z.infer<typeof deviceBindingSummarySchema>;
export type DeviceBindingList = z.infer<typeof deviceBindingListSchema>;
export type ActiveDeviceLeaseStatus = z.infer<typeof activeDeviceLeaseStatusSchema>;
export type CloudScope = z.infer<typeof cloudScopeSchema>;
export type DeviceAuthorityProjection = z.infer<typeof deviceAuthorityProjectionSchema>;
export type DeviceRemovalRequest = z.infer<typeof deviceRemovalRequestSchema>;
export type DeviceSwitchRequest = z.infer<typeof deviceSwitchRequestSchema>;
export type DeviceSwitchRequestView = z.infer<typeof deviceSwitchRequestViewSchema>;
