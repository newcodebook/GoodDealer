import { z } from "zod";

import { encodeDomainSeparatedWireValue, identifier, safePositiveInteger } from "../wire/index";
import { workspaceTenantScopeSchema, type WorkspaceTenantScope } from "./tenant-scope";

export const PERSISTENT_JOB_CREATE_SCHEMA_VERSION = 1 as const;
export const MAX_PERSISTENT_JOB_CREATE_BYTES = 64 * 1024;

const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const triggerSchema = z.object({
  kind: z.enum(["authenticated_public", "admin_action", "system_fan_out", "compliance_deletion"]),
  ref: identifier,
}).strict();
const authorizationSchema = z.object({
  kind: z.enum(["public_session", "admin_action", "system_policy", "data_rights_request"]),
  ref: identifier,
  revision: safePositiveInteger,
  digest,
}).strict();
const runtimePolicySchema = z.object({
  id: identifier,
  version: safePositiveInteger,
  maxAttempts: safePositiveInteger.max(100),
  attemptTimeoutSeconds: safePositiveInteger.max(86_400),
  leaseSeconds: safePositiveInteger.max(3_600),
  baseBackoffSeconds: safePositiveInteger.max(86_400),
  retryMode: z.enum(["database_safe", "manual_only"]),
}).strict().refine((value) => value.leaseSeconds <= value.attemptTimeoutSeconds, {
  message: "lease must not exceed attempt timeout",
});

export const persistentJobCreateRequestSchema = z.object({
  schemaVersion: z.literal(PERSISTENT_JOB_CREATE_SCHEMA_VERSION),
  tenant: workspaceTenantScopeSchema,
  idempotencyKey: identifier,
  jobKind: identifier,
  targetModule: identifier,
  payloadVersion: safePositiveInteger,
  partitionKey: identifier,
  trigger: triggerSchema,
  authorization: authorizationSchema,
  runtimePolicy: runtimePolicySchema,
  payload: z.unknown(),
}).strict();

export type PersistentJobCreateRequest = z.infer<typeof persistentJobCreateRequestSchema>;
export type PersistentJobRuntimePolicy = z.infer<typeof runtimePolicySchema>;

/**
 * Parse an untrusted create request without evaluating accessors or inherited properties.
 * Tenant authority is supplied independently by the already-authenticated boundary.
 */
export function parsePersistentJobCreateRequest(
  value: unknown,
  trustedTenant: WorkspaceTenantScope,
): PersistentJobCreateRequest {
  assertOwnDataTree(value, "$", 0);
  const encoded = encodeDomainSeparatedWireValue("gooddealer.job.create-wire.v1", value);
  if (encoded.byteLength > MAX_PERSISTENT_JOB_CREATE_BYTES) {
    throw new TypeError("persistent job create request exceeds the wire limit");
  }
  const parsed = persistentJobCreateRequestSchema.parse(value);
  if (
    parsed.tenant.accountId !== trustedTenant.accountId ||
    parsed.tenant.workspaceId !== trustedTenant.workspaceId
  ) throw new TypeError("persistent job tenant does not match trusted scope");
  return parsed;
}

export function encodePersistentJobPayloadDigestInput(payload: unknown): Uint8Array {
  assertOwnDataTree(payload, "$.payload", 0);
  return encodeDomainSeparatedWireValue("gooddealer.job.payload.v1", payload);
}

export function encodePersistentJobRequestDigestInput(input: {
  readonly request: Omit<PersistentJobCreateRequest, "payload">;
  readonly payloadDigest: string;
}): Uint8Array {
  return encodeDomainSeparatedWireValue("gooddealer.job.request.v1", {
    ...input.request,
    payloadDigest: digest.parse(input.payloadDigest),
  });
}

function assertOwnDataTree(value: unknown, path: string, depth: number): void {
  if (depth > 32) throw new TypeError(`${path} exceeds maximum nesting`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError(`${path} contains a non-safe integer`);
    return;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${path} has an unsupported array prototype`);
    const keys = Reflect.ownKeys(value);
    const expectedKeys = Array.from({ length: value.length }, (_, index) => String(index));
    expectedKeys.push("length");
    if (
      keys.length !== expectedKeys.length ||
      expectedKeys.some((key) => !keys.includes(key))
    ) throw new TypeError(`${path} contains unsupported array keys`);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
      lengthDescriptor.value !== value.length || lengthDescriptor.enumerable
    ) throw new TypeError(`${path}.length is not the canonical array length property`);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`${path}[${index}] is not an own enumerable data property`);
      }
      assertOwnDataTree(descriptor.value, `${path}[${index}]`, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") throw new TypeError(`${path} contains an unsupported value`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} has an unsupported prototype`);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === "symbol")) throw new TypeError(`${path} contains symbol keys`);
  for (const key of keys) {
    if (typeof key !== "string") throw new TypeError(`${path} contains unsupported keys`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${path}.${key} is not an own enumerable data property`);
    }
    assertOwnDataTree(descriptor.value, `${path}.${key}`, depth + 1);
  }
}
