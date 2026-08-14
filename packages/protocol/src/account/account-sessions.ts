import { z } from "zod";

import { canonicalUtcTimestamp, displayLabel, identifier, safePositiveInteger } from "../wire/index";

export const ACCOUNT_SESSION_SCHEMA_VERSION = 1 as const;

export const accountSessionClientKindSchema = z.enum(["desktop", "account_web"]);

export const accountSessionSummarySchema = z
  .object({
    schemaVersion: z.literal(ACCOUNT_SESSION_SCHEMA_VERSION),
    sessionId: identifier,
    clientKind: accountSessionClientKindSchema,
    deviceId: identifier.nullable(),
    displayName: displayLabel,
    createdAt: canonicalUtcTimestamp,
    lastSeenAt: canonicalUtcTimestamp,
    currentSession: z.boolean(),
    status: z.enum(["active", "revoked"]),
    revokedAt: canonicalUtcTimestamp.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.clientKind === "account_web" && value.deviceId !== null) {
      context.addIssue({ code: "custom", path: ["deviceId"], message: "account web sessions are not devices" });
    }
    if (value.clientKind === "desktop" && value.deviceId === null) {
      context.addIssue({ code: "custom", path: ["deviceId"], message: "desktop sessions require a device" });
    }
    if ((value.status === "revoked") !== (value.revokedAt !== null)) {
      context.addIssue({ code: "custom", path: ["revokedAt"], message: "revocation timestamp must agree with status" });
    }
    if (value.status === "revoked" && value.currentSession) {
      context.addIssue({ code: "custom", path: ["currentSession"], message: "a revoked session cannot be current" });
    }
  });

export const accountSessionListSchema = z
  .object({
    schemaVersion: z.literal(ACCOUNT_SESSION_SCHEMA_VERSION),
    listRevision: safePositiveInteger,
    sessions: z.array(accountSessionSummarySchema).max(64),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.sessions.map(({ sessionId }) => sessionId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: ["sessions"], message: "session ids must be unique" });
    }
    if (value.sessions.filter(({ currentSession }) => currentSession).length > 1) {
      context.addIssue({ code: "custom", path: ["sessions"], message: "at most one session may be current" });
    }
  });

export const accountSessionRevokeRequestSchema = z.discriminatedUnion("scope", [
  z.object({
    schemaVersion: z.literal(ACCOUNT_SESSION_SCHEMA_VERSION),
    scope: z.literal("session"),
    sessionId: identifier,
    expectedListRevision: safePositiveInteger,
  }).strict(),
  z.object({
    schemaVersion: z.literal(ACCOUNT_SESSION_SCHEMA_VERSION),
    scope: z.literal("all_other_sessions"),
    expectedListRevision: safePositiveInteger,
    reauthProofId: identifier,
  }).strict(),
]);

export type AccountSessionClientKind = z.infer<typeof accountSessionClientKindSchema>;
export type AccountSessionSummary = z.infer<typeof accountSessionSummarySchema>;
export type AccountSessionList = z.infer<typeof accountSessionListSchema>;
export type AccountSessionRevokeRequest = z.infer<typeof accountSessionRevokeRequestSchema>;
