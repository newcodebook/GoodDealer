import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  cloudflareObservationReadRequestSchema,
  cloudflareObservationReadResponseSchema,
  cloudflareObservationSubmitRequestSchema,
  cloudflareObservationSubmitResponseSchema,
  copyUntrustedCloudflareWire,
  parseCloudflareObservationSubmitRequest,
} from "@gooddealer/protocol/connectors";

const corpus = JSON.parse(readFileSync(new URL("../test-vectors/cloudflare-observation/wire-corpus.json", import.meta.url), "utf8")) as {
  validSubmitRequests: unknown[];
  invalidSubmitRequests: unknown[];
  validSubmitResponses: unknown[];
  invalidSubmitResponses: unknown[];
};
const submit = corpus.validSubmitRequests[0] as Record<string, unknown>;

describe("Protocol-owned Cloudflare observation contract", () => {
  it("accepts every shared valid vector and rejects every shared invalid vector", () => {
    for (const value of corpus.validSubmitRequests) expect(parseCloudflareObservationSubmitRequest(value)).toEqual(value);
    for (const value of corpus.invalidSubmitRequests) expect(() => parseCloudflareObservationSubmitRequest(value)).toThrow();
    for (const value of corpus.validSubmitResponses) expect(cloudflareObservationSubmitResponseSchema.parse(value)).toEqual(value);
    for (const value of corpus.invalidSubmitResponses) expect(cloudflareObservationSubmitResponseSchema.safeParse(value).success).toBe(false);
  });

  it("enforces exact Provider/capability identity, timestamp units, Zone, TTL, retry and sequence bounds", () => {
    expect(cloudflareObservationSubmitRequestSchema.safeParse({ ...submit, providerKind: "other" }).success).toBe(false);
    expect(cloudflareObservationSubmitRequestSchema.safeParse({ ...submit, observationCapability: "registrar" }).success).toBe(false);
    expect(cloudflareObservationSubmitRequestSchema.safeParse({ ...submit, observedAt: "2026-08-20T06:00:00.000Z" }).success).toBe(false);
    const available = submit.result as { zone: object; records: readonly [Record<string, unknown>, ...Record<string, unknown>[]] };
    expect(cloudflareObservationSubmitRequestSchema.safeParse({ ...submit, result: { ...available, zone: { ...available.zone, zoneId: "A".repeat(32) } } }).success).toBe(false);
    for (const ttl of [0, 2_147_483_648, 1.5, "1"]) {
      expect(cloudflareObservationSubmitRequestSchema.safeParse({ ...submit, result: { ...available, records: [{ ...available.records[0], ttl }] } }).success).toBe(false);
    }
    for (const providerVersionToken of ["2026-08-20T05:59:59Z", "2026-08-20T05:59:59.12Z", "2026-08-20T05:59:59.1234Z"]) {
      expect(cloudflareObservationSubmitRequestSchema.safeParse({ ...submit, result: { ...available, records: [{ ...available.records[0], providerVersionToken }] } }).success).toBe(false);
    }
    for (const code of ["authentication", "permission", "rate_limited", "temporarily_unavailable", "invalid_observation"]) {
      expect(cloudflareObservationSubmitRequestSchema.safeParse({ ...submit, result: { status: "unavailable", zoneId: "0".repeat(32), code, retryAfterSeconds: null } }).success).toBe(true);
    }
    expect(cloudflareObservationSubmitRequestSchema.safeParse({ ...submit, result: { status: "unavailable", zoneId: "0".repeat(32), code: "invalid_response", retryAfterSeconds: null } }).success).toBe(false);
    expect(cloudflareObservationSubmitRequestSchema.safeParse({ ...submit, result: { status: "unavailable", zoneId: "0".repeat(32), code: "rate_limited", retryAfterSeconds: 86_401 } }).success).toBe(false);
  });

  it("requires Provider/capability identity and positive-safe observation sequence on reads and writes", () => {
    expect(cloudflareObservationReadRequestSchema.parse({})).toEqual({});
    const result = cloudflareObservationReadResponseSchema.parse({
      schemaVersion: 1,
      observations: [{ providerKind: "cloudflare", observationCapability: "dns", connectionId: "connection", observedAt: "2026-08-20T06:00:00Z", result: (submit as { result: unknown }).result, observationSequence: 1 }],
    });
    expect(result.observations[0]?.providerKind).toBe("cloudflare");
    expect(cloudflareObservationSubmitResponseSchema.safeParse({ schemaVersion: 1, accepted: true, observationSequence: 1 }).success).toBe(false);
  });

  it("rejects accessors, symbols, cycles, prototypes, sparse arrays, depth, width, bytes and authority keys", () => {
    let getterCalled = false;
    const accessor = { ...submit };
    Object.defineProperty(accessor, "result", { enumerable: true, get() { getterCalled = true; return submit.result; } });
    expect(() => parseCloudflareObservationSubmitRequest(accessor)).toThrow();
    expect(getterCalled).toBe(false);
    const symbol = { ...submit, [Symbol("token")]: "secret" };
    expect(() => parseCloudflareObservationSubmitRequest(symbol)).toThrow();
    const cycle = { ...submit } as Record<string, unknown>; cycle.extra = cycle;
    expect(() => parseCloudflareObservationSubmitRequest(cycle)).toThrow();
    expect(() => parseCloudflareObservationSubmitRequest(Object.assign(Object.create({ inherited: true }), submit))).toThrow();
    const sparse = { ...submit, result: { ...(submit.result as object), records: new Array(1) } };
    expect(() => parseCloudflareObservationSubmitRequest(sparse)).toThrow();
    let deep: unknown = "leaf"; for (let index = 0; index < 10; index += 1) deep = { nested: deep };
    expect(() => copyUntrustedCloudflareWire({ ...submit, extension: deep })).toThrow();
    expect(() => copyUntrustedCloudflareWire({ ...submit, extension: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`x${index}`, index])) })).toThrow();
    expect(() => copyUntrustedCloudflareWire({ ...submit, extension: "x".repeat(8 * 1024 * 1024) })).toThrow();
    for (const key of ["token", "credentialRef", "url", "method", "headers", "accountId", "workspaceId", "providerResponse", "diagnostic", "write", "browser"]) {
      expect(() => parseCloudflareObservationSubmitRequest({ ...submit, result: { ...(submit.result as object), nested: { [key]: "sentinel" } } })).toThrow();
    }
  });
});
