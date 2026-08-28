import { z } from "zod";

import { canonicalUtcTimestamp, identifier, safePositiveInteger } from "../wire/index";

export const CONNECTORS_PROTOCOL_VERSION = 1 as const;
export const CLOUDFLARE_PROVIDER_KIND = "cloudflare" as const;
export const CLOUDFLARE_OBSERVATION_CAPABILITY = "dns" as const;
export const MAX_CLOUDFLARE_IDENTIFIER_BYTES = 256 as const;
export const MAX_CLOUDFLARE_FQDN_BYTES = 253 as const;
export const MAX_CLOUDFLARE_RECORD_CONTENT_BYTES = 4_096 as const;
export const MAX_CLOUDFLARE_OBSERVATION_RECORDS = 1_024 as const;
export const MAX_CLOUDFLARE_RETRY_AFTER_SECONDS = 86_400 as const;
export const MAX_CLOUDFLARE_TTL_SECONDS = 2_147_483_647 as const;

const MAX_WIRE_BYTES = 8 * 1024 * 1024;
const MAX_WIRE_DEPTH = 8;
const MAX_WIRE_NODES = 16_384;
const MAX_OBJECT_FIELDS = 16;
const MAX_ARRAY_ITEMS = 10_000;
const utf8Encoder = new TextEncoder();
const forbiddenWireKeys = new Set([
  "accountid", "adapter", "auth", "authorization", "backup", "body", "browser", "constructor",
  "cookie", "credential", "credentialref", "credentials", "diagnostic", "endpoint", "execution",
  "executionmode", "fallback", "file", "header", "headers", "html", "import", "iscurrent", "manual",
  "method", "operation", "operationkind", "owner", "provider", "providerbody", "providerresponse",
  "providerselector", "proto", "prototype", "proxy", "raw", "rawbody", "redirect", "request",
  "response", "screenshot", "secret", "secretref", "session", "stale", "subject", "tenant", "token",
  "tokenref", "url", "workspaceid", "write",
]);

function compareUtf8(left: string, right: string): number {
  const leftBytes = utf8Encoder.encode(left);
  const rightBytes = utf8Encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index]! - rightBytes[index]!;
  }
  return leftBytes.length - rightBytes.length;
}

function boundedUtf8String(maxBytes: number, allowEmpty = false) {
  return z.string().refine(
    (value) => (allowEmpty || value.length > 0) && utf8Encoder.encode(value).byteLength <= maxBytes,
    `value must be ${allowEmpty ? "" : "non-empty and "}at most ${maxBytes} UTF-8 bytes`,
  );
}

const cloudflareIdentifierSchema = boundedUtf8String(MAX_CLOUDFLARE_IDENTIFIER_BYTES)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "identifier rejects control characters");
export const cloudflareZoneIdSchema = z.string().regex(/^[0-9a-f]{32}$/u);
const cloudflareFqdnSchema = boundedUtf8String(MAX_CLOUDFLARE_FQDN_BYTES)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u);
const cloudflareRecordContentSchema = boundedUtf8String(MAX_CLOUDFLARE_RECORD_CONTENT_BYTES, true)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "record content rejects control characters");
export const cloudflareSourceVersionSchema = z.string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u)
  .refine((value) => Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value,
    "providerVersionToken must be a real canonical UTC millisecond");

export const cloudflareDnsRecordTypeSchema = z.enum(["A", "AAAA", "CNAME", "TXT"]);
export const cloudflareObservationRecordSchema = z.object({
  recordId: cloudflareIdentifierSchema,
  fqdn: cloudflareFqdnSchema,
  type: cloudflareDnsRecordTypeSchema,
  content: cloudflareRecordContentSchema,
  ttl: z.number().int().min(1).max(MAX_CLOUDFLARE_TTL_SECONDS),
  proxied: z.boolean(),
  providerVersionToken: cloudflareSourceVersionSchema,
}).strict().superRefine((record, context) => {
  const valid = record.type === "A" ? isIpv4(record.content)
    : record.type === "AAAA" ? isIpv6(record.content)
      : record.type === "CNAME" ? cloudflareFqdnSchema.safeParse(record.content).success
        : !record.proxied;
  if (!valid) context.addIssue({ code: "custom", path: ["content"], message: "record content does not match its type" });
});

const cloudflareObservationRecordsSchema = z.array(cloudflareObservationRecordSchema)
  .max(MAX_CLOUDFLARE_OBSERVATION_RECORDS)
  .superRefine((records, context) => {
    const key = (record: z.infer<typeof cloudflareObservationRecordSchema>) => `${record.fqdn}\u0000${record.type}\u0000${record.recordId}`;
    for (let index = 1; index < records.length; index += 1) {
      if (compareUtf8(key(records[index - 1]!), key(records[index]!)) >= 0) {
        context.addIssue({ code: "custom", path: [index], message: "records must be unique and canonically ordered" });
        break;
      }
    }
  });

export const cloudflareAvailableObservationResultSchema = z.object({
  status: z.literal("available"),
  zone: z.object({ zoneId: cloudflareZoneIdSchema, zoneName: cloudflareFqdnSchema, status: z.enum(["active", "pending"]) }).strict(),
  records: cloudflareObservationRecordsSchema,
}).strict().superRefine((result, context) => {
  for (const [index, record] of result.records.entries()) {
    if (record.fqdn !== result.zone.zoneName && !record.fqdn.endsWith(`.${result.zone.zoneName}`)) {
      context.addIssue({ code: "custom", path: ["records", index, "fqdn"], message: "record must belong to the observed Zone" });
    }
  }
});

export const cloudflareUnavailableObservationCodeSchema = z.enum([
  "authentication", "permission", "rate_limited", "temporarily_unavailable", "invalid_observation",
]);
export const cloudflareUnavailableObservationResultSchema = z.object({
  status: z.literal("unavailable"),
  zoneId: cloudflareZoneIdSchema,
  code: cloudflareUnavailableObservationCodeSchema,
  retryAfterSeconds: z.number().int().min(0).max(MAX_CLOUDFLARE_RETRY_AFTER_SECONDS).nullable(),
}).strict().superRefine((value, context) => {
  if (value.code !== "rate_limited" && value.retryAfterSeconds !== null) {
    context.addIssue({ code: "custom", path: ["retryAfterSeconds"], message: "retry delay is allowed only for rate-limited observations" });
  }
});
export const cloudflareObservationResultSchema = z.discriminatedUnion("status", [
  cloudflareAvailableObservationResultSchema, cloudflareUnavailableObservationResultSchema,
]);

export const cloudflareObservationSubmitRequestSchema = z.object({
  schemaVersion: z.literal(CONNECTORS_PROTOCOL_VERSION),
  providerKind: z.literal(CLOUDFLARE_PROVIDER_KIND),
  observationCapability: z.literal(CLOUDFLARE_OBSERVATION_CAPABILITY),
  observationId: identifier,
  connectionId: cloudflareIdentifierSchema,
  observedAt: canonicalUtcTimestamp,
  result: cloudflareObservationResultSchema,
}).strict();
export const cloudflareObservationSubmitResponseSchema = z.object({
  schemaVersion: z.literal(CONNECTORS_PROTOCOL_VERSION),
  accepted: z.literal(true),
  observationSequence: safePositiveInteger,
  disposition: z.enum(["current", "stale"]),
}).strict();
export const cloudflareObservationReadRequestSchema = z.object({}).strict();
export const cloudflareObservationSchema = z.object({
  providerKind: z.literal(CLOUDFLARE_PROVIDER_KIND),
  observationCapability: z.literal(CLOUDFLARE_OBSERVATION_CAPABILITY),
  connectionId: cloudflareIdentifierSchema,
  observedAt: canonicalUtcTimestamp,
  result: cloudflareObservationResultSchema,
  observationSequence: safePositiveInteger,
}).strict();
export const cloudflareObservationReadResponseSchema = z.object({
  schemaVersion: z.literal(CONNECTORS_PROTOCOL_VERSION),
  observations: z.array(cloudflareObservationSchema).max(10_000),
}).strict().superRefine((value, context) => {
  const key = (observation: z.infer<typeof cloudflareObservationSchema>) => {
    const zoneId = observation.result.status === "available" ? observation.result.zone.zoneId : observation.result.zoneId;
    return `${observation.connectionId}\u0000${zoneId}`;
  };
  for (let index = 1; index < value.observations.length; index += 1) {
    if (compareUtf8(key(value.observations[index - 1]!), key(value.observations[index]!)) >= 0) {
      context.addIssue({ code: "custom", path: ["observations", index], message: "observations must be unique and canonically ordered" });
      break;
    }
  }
});
export const cloudflareObservationConflictRejectionSchema = z.object({
  schemaVersion: z.literal(CONNECTORS_PROTOCOL_VERSION),
  code: z.literal("OBSERVATION_CONFLICT"), retryable: z.literal(false), retryAfterSeconds: z.null(), correlationId: identifier,
}).strict();

export function parseCloudflareObservationSubmitRequest(input: unknown): CloudflareObservationSubmitRequest {
  return cloudflareObservationSubmitRequestSchema.parse(copyUntrustedCloudflareWire(input));
}
export function parseCloudflareObservationSubmitResponse(input: unknown): CloudflareObservationSubmitResponse {
  return cloudflareObservationSubmitResponseSchema.parse(copyUntrustedCloudflareWire(input));
}
export function parseCloudflareObservationReadResponse(input: unknown): CloudflareObservationReadResponse {
  return cloudflareObservationReadResponseSchema.parse(copyUntrustedCloudflareWire(input));
}

export function copyUntrustedCloudflareWire(input: unknown): unknown {
  const active = new Set<object>();
  let nodes = 0;
  const copy = (value: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > MAX_WIRE_NODES || depth > MAX_WIRE_DEPTH) throw new TypeError("invalid Cloudflare wire value");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError("invalid Cloudflare wire value");
      return value;
    }
    if (typeof value !== "object" || active.has(value)) throw new TypeError("invalid Cloudflare wire value");
    active.add(value);
    try {
      if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) throw new TypeError("invalid Cloudflare wire value");
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_ARRAY_ITEMS) throw new TypeError("invalid Cloudflare wire value");
        const names = Object.getOwnPropertyNames(value);
        if (names.length !== value.length + 1 || !names.includes("length")) throw new TypeError("invalid Cloudflare wire value");
        return Array.from({ length: value.length }, (_, index) => {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) throw new TypeError("invalid Cloudflare wire value");
          return copy(descriptor.value, depth + 1);
        });
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError("invalid Cloudflare wire value");
      const names = Object.getOwnPropertyNames(value);
      if (names.length > MAX_OBJECT_FIELDS) throw new TypeError("invalid Cloudflare wire value");
      const result: Record<string, unknown> = {};
      for (const name of names) {
        if (forbiddenWireKeys.has(name.toLowerCase().replace(/[^a-z0-9]/gu, ""))) throw new TypeError("invalid Cloudflare wire value");
        const descriptor = descriptors[name];
        if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) throw new TypeError("invalid Cloudflare wire value");
        result[name] = copy(descriptor.value, depth + 1);
      }
      return result;
    } finally {
      active.delete(value);
    }
  };
  const copied = copy(input, 0);
  const serialized = JSON.stringify(copied);
  if (serialized === undefined || utf8Encoder.encode(serialized).byteLength > MAX_WIRE_BYTES) throw new TypeError("invalid Cloudflare wire value");
  return copied;
}

function isIpv4(input: string): boolean {
  const octets = input.split(".");
  return octets.length === 4 && octets.every((octet) => /^(0|[1-9][0-9]{0,2})$/u.test(octet) && Number(octet) <= 255);
}
function isIpv6(input: string): boolean {
  if (input.length === 0 || input.includes(":::")) return false;
  const halves = input.split("::");
  if (halves.length > 2) return false;
  const groups = [...(halves[0] ? halves[0].split(":") : []), ...(halves[1] ? halves[1].split(":") : [])];
  let count = 0;
  for (const [index, group] of groups.entries()) {
    if (group.includes(".")) {
      if (index !== groups.length - 1 || !isIpv4(group)) return false;
      count += 2;
    } else {
      if (!/^[0-9a-fA-F]{1,4}$/u.test(group)) return false;
      count += 1;
    }
  }
  return halves.length === 2 ? count < 8 : count === 8;
}

export type CloudflareDnsRecordType = z.infer<typeof cloudflareDnsRecordTypeSchema>;
export type CloudflareObservationRecord = z.infer<typeof cloudflareObservationRecordSchema>;
export type CloudflareAvailableObservationResult = z.infer<typeof cloudflareAvailableObservationResultSchema>;
export type CloudflareUnavailableObservationCode = z.infer<typeof cloudflareUnavailableObservationCodeSchema>;
export type CloudflareUnavailableObservationResult = z.infer<typeof cloudflareUnavailableObservationResultSchema>;
export type CloudflareObservationResult = z.infer<typeof cloudflareObservationResultSchema>;
export type CloudflareObservationSubmitRequest = z.infer<typeof cloudflareObservationSubmitRequestSchema>;
export type CloudflareObservationSubmitResponse = z.infer<typeof cloudflareObservationSubmitResponseSchema>;
export type CloudflareObservationReadRequest = z.infer<typeof cloudflareObservationReadRequestSchema>;
export type CloudflareObservation = z.infer<typeof cloudflareObservationSchema>;
export type CloudflareObservationReadResponse = z.infer<typeof cloudflareObservationReadResponseSchema>;
export type CloudflareObservationConflictRejection = z.infer<typeof cloudflareObservationConflictRejectionSchema>;
