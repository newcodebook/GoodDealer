import { z } from "zod";
import {
  canonicalUtcTimestamp,
  encodeDomainSeparatedWireValue,
  identifier,
  safePositiveInteger,
} from "../wire/index";
import { desktopAuthorizationGrantSchema } from "./authorization-grant";

export const DESKTOP_EXECUTION_CONTEXT_REQUEST_LIMIT_BYTES = 1024;
export const DESKTOP_EXECUTION_CONTEXT_RESPONSE_LIMIT_BYTES = 32768;
export const DESKTOP_EXECUTION_CONTEXT_MAX_ROUND_TRIP_MS = 30000;
export const DESKTOP_EXECUTION_CONTEXT_SIGNATURE_DOMAIN = "GOODDEALER-DESKTOP-EXECUTION-CONTEXT-V1";
// Fixed-length base64url encodings also constrain unused trailing bits. No runtime-specific decoder.
const digest = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
const signature = z.string().regex(/^[A-Za-z0-9_-]{85}[AQgw]$/u);
export const desktopExecutionContextRequestSchema = z
  .object({ schemaVersion: z.literal(1), nonce: digest })
  .strict();
export const desktopExecutionContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    typ: z.literal("gd.desktop-execution-context.v1"),
    iss: z.literal("https://accounts.gooddealer.com"),
    aud: z.literal("gooddealer-desktop/execution-evidence"),
    kid: identifier,
    nonce: digest,
    accountId: identifier,
    workspaceId: identifier,
    deviceId: identifier,
    accountSecurityEpoch: safePositiveInteger,
    activeLeaseEpoch: safePositiveInteger,
    credentialEpoch: safePositiveInteger,
    signingKeyId: identifier,
    signingKeyVersion: safePositiveInteger,
    authorizationGrantDigest: digest,
    serverObservedAt: canonicalUtcTimestamp,
    expiresAt: canonicalUtcTimestamp,
    signature,
  })
  .strict()
  .superRefine((value, ctx) => {
    const lifetime = Date.parse(value.expiresAt) - Date.parse(value.serverObservedAt);
    if (lifetime <= 0 || lifetime > 86400000)
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "context deadline is invalid" });
  });
export const desktopExecutionContextResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    grant: desktopAuthorizationGrantSchema,
    context: desktopExecutionContextSchema,
  })
  .strict()
  .superRefine(({ grant, context }, ctx) => {
    const lease = grant.activeDeviceLease;
    const deadline = [
      grant.expiresAt,
      lease.payload.offlineExecuteUntil,
      grant.commercialAuthority.commercialExpiresAt,
    ].sort()[0];
    if (
      context.accountId !== lease.accountId ||
      context.workspaceId !== grant.workspace.workspaceId ||
      context.deviceId !== lease.deviceId ||
      context.accountSecurityEpoch !== lease.accountSecurityEpoch ||
      context.activeLeaseEpoch !== lease.payload.leaseEpoch ||
      context.expiresAt !== deadline ||
      context.serverObservedAt < grant.issuedAt ||
      context.serverObservedAt < lease.issuedAt
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["context"],
        message: "context must match the returned authorization",
      });
    }
  });
export function encodeDesktopExecutionContextSignatureTranscript(input: unknown): Uint8Array {
  const { signature: _signature, ...claims } = desktopExecutionContextSchema.parse(input);
  return encodeDomainSeparatedWireValue(DESKTOP_EXECUTION_CONTEXT_SIGNATURE_DOMAIN, claims);
}
export function encodeDesktopExecutionAuthorizationDigestInput(input: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(
    "GOODDEALER-DESKTOP-EXECUTION-AUTHORIZATION-V1",
    desktopAuthorizationGrantSchema.parse(input),
  );
}
export function encodeDesktopExecutionContextEnvelope(input: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(
    "GOODDEALER-DESKTOP-EXECUTION-CONTEXT-ENVELOPE-V1",
    desktopExecutionContextSchema.parse(input),
  );
}
export type DesktopExecutionContextRequest = z.infer<typeof desktopExecutionContextRequestSchema>;
export type DesktopExecutionContext = z.infer<typeof desktopExecutionContextSchema>;
export type DesktopExecutionContextResponse = z.infer<typeof desktopExecutionContextResponseSchema>;
