import { z } from "zod";

import { canonicalUtcTimestamp, encodeDomainSeparatedWireValue, safePositiveInteger } from "../wire/index";

export const CLOUDFLARE_DNS_PROJECTION_SCHEMA_VERSION = 1 as const;
export const MAX_CLOUDFLARE_DNS_PROJECTION_BYTES = 64 * 1024;
export const MAX_CLOUDFLARE_DNS_SOURCE_ADVANCE = 4_096;
export const CLOUDFLARE_DNS_PROJECTION_DIGEST_DOMAIN = "GOODDEALER-CLOUDFLARE-DNS-PROJECTION-V1" as const;

const utf8 = new TextEncoder();
const observationIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const entityIdSchema = z.string().min(1).max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u);
const countSchema = z.number().int().min(0).max(1_024);
const availableCountsSchema = z.object({
  a: countSchema,
  aaaa: countSchema,
  cname: countSchema,
  txt: countSchema,
  proxied: countSchema,
}).strict();
const unavailableCountsSchema = z.object({
  a: z.null(),
  aaaa: z.null(),
  cname: z.null(),
  txt: z.null(),
  proxied: z.null(),
}).strict();

const projectionBase = {
  schemaVersion: z.literal(CLOUDFLARE_DNS_PROJECTION_SCHEMA_VERSION),
  providerKind: z.literal("cloudflare"),
  observationCapability: z.literal("dns"),
  observationId: observationIdSchema,
  entityId: entityIdSchema,
  leaseEpoch: safePositiveInteger,
  sourceSequence: safePositiveInteger,
  observedAt: canonicalUtcTimestamp,
};

export const cloudflareDnsProjectionRequestSchema = z.discriminatedUnion("availability", [
  z.object({
    ...projectionBase,
    availability: z.literal("available"),
    zoneStatus: z.enum(["active", "pending"]),
    counts: availableCountsSchema,
  }).strict().superRefine((value, context) => {
    const total = value.counts.a + value.counts.aaaa + value.counts.cname + value.counts.txt;
    if (total > 1_024) context.addIssue({ code: "custom", path: ["counts"], message: "record total exceeds 1024" });
    if (value.counts.proxied > value.counts.a + value.counts.aaaa + value.counts.cname) {
      context.addIssue({ code: "custom", path: ["counts", "proxied"], message: "proxied count exceeds proxyable records" });
    }
  }),
  z.object({
    ...projectionBase,
    availability: z.literal("unavailable"),
    zoneStatus: z.literal("unknown"),
    counts: unavailableCountsSchema,
  }).strict(),
]);

export const cloudflareDnsProjectionAckSchema = z.object({
  schemaVersion: z.literal(CLOUDFLARE_DNS_PROJECTION_SCHEMA_VERSION),
  accepted: z.literal(true),
  observationId: observationIdSchema,
  leaseEpoch: safePositiveInteger,
  sourceSequence: safePositiveInteger,
  canonicalRequestDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  observationSequence: safePositiveInteger,
  disposition: z.enum(["current", "stale"]),
}).strict();

declare const cloudflareDnsProjectionBrand: unique symbol;
declare const cloudflareDnsProjectionAckBrand: unique symbol;
export type CloudflareDnsProjectionRequest = z.infer<typeof cloudflareDnsProjectionRequestSchema> & {
  readonly [cloudflareDnsProjectionBrand]: true;
};
export type CloudflareDnsProjectionAck = z.infer<typeof cloudflareDnsProjectionAckSchema> & {
  readonly [cloudflareDnsProjectionAckBrand]: true;
};

export function parseCloudflareDnsProjectionRequest(input: unknown): CloudflareDnsProjectionRequest {
  return cloudflareDnsProjectionRequestSchema.parse(copyProjectionWire(input)) as CloudflareDnsProjectionRequest;
}

export function parseCloudflareDnsProjectionAck(input: unknown): CloudflareDnsProjectionAck {
  return cloudflareDnsProjectionAckSchema.parse(copyProjectionWire(input)) as CloudflareDnsProjectionAck;
}

/** Canonical bytes covered by the Cloudflare DNS projection request digest. */
export function cloudflareDnsProjectionDigestInput(request: CloudflareDnsProjectionRequest): Uint8Array {
  const { schemaVersion, providerKind, observationCapability, observationId, entityId, leaseEpoch,
    sourceSequence, observedAt, availability, zoneStatus, counts } = request;
  return encodeDomainSeparatedWireValue(CLOUDFLARE_DNS_PROJECTION_DIGEST_DOMAIN, {
    schemaVersion, providerKind, observationCapability, observationId, entityId,
    leaseEpoch, sourceSequence, observedAt, availability, zoneStatus, counts,
  });
}

export function cloudflareDnsProjectionDigest(
  request: CloudflareDnsProjectionRequest,
  sha256: (bytes: Uint8Array) => Uint8Array,
): string {
  const digest = sha256(cloudflareDnsProjectionDigestInput(request));
  if (digest.byteLength !== 32) throw new TypeError("SHA-256 must produce 32 bytes");
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Descriptor-safe copy used before schema parsing so getters/prototypes cannot execute. */
function copyProjectionWire(input: unknown): unknown {
  const active = new Set<object>();
  let nodes = 0;
  const forbidden = new Set(["accountid", "authorization", "body", "connectionid", "cookie",
    "credential", "deviceid", "header", "provideraccountid", "recordid", "secret", "tenantid",
    "token", "url", "workspaceid", "zoneid", "zonename"]);
  const copy = (value: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > 128 || depth > 3) throw new TypeError("invalid Cloudflare DNS projection");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError("invalid Cloudflare DNS projection");
      return value;
    }
    if (typeof value !== "object" || active.has(value) || Array.isArray(value)) {
      throw new TypeError("invalid Cloudflare DNS projection");
    }
    active.add(value);
    try {
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new TypeError("invalid Cloudflare DNS projection");
      }
      const keys = Reflect.ownKeys(value);
      if (keys.length > 16 || keys.some((key) => typeof key !== "string")) {
        throw new TypeError("invalid Cloudflare DNS projection");
      }
      const output: Record<string, unknown> = {};
      for (const key of keys as string[]) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
        if (forbidden.has(normalized)) throw new TypeError("invalid Cloudflare DNS projection");
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError("invalid Cloudflare DNS projection");
        }
        output[key] = copy(descriptor.value, depth + 1);
      }
      return output;
    } finally {
      active.delete(value);
    }
  };
  const result = copy(input, 0);
  const serialized = JSON.stringify(result);
  if (utf8.encode(serialized).byteLength > MAX_CLOUDFLARE_DNS_PROJECTION_BYTES) {
    throw new TypeError("invalid Cloudflare DNS projection");
  }
  return result;
}
