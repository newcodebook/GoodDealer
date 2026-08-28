import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CloudflareContractError,
  parseCloudflareObservationError,
  parseCloudflareObservationSubmitRequest,
  parseCloudflareZoneReadIntent,
} from "../src/index";

const ZONE_ID = "0123456789abcdef0123456789abcdef";
const corpus = JSON.parse(readFileSync(new URL("../../../protocol/test-vectors/cloudflare-observation/wire-corpus.json", import.meta.url), "utf8")) as {
  validSubmitRequests: unknown[];
  invalidSubmitRequests: unknown[];
};

function expectInvalid(operation: () => unknown): void {
  expect(operation).toThrow(CloudflareContractError);
  expect(operation).toThrowError("invalid cloudflare observation data");
}

describe("Cloudflare Host-local contracts", () => {
  it("rebuilds only the exact non-secret read intent", () => {
    const input = { connectionId: "connection-1", zoneId: ZONE_ID };
    const parsed = parseCloudflareZoneReadIntent(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    for (const invalid of [
      { connectionId: "", zoneId: ZONE_ID },
      { connectionId: "é".repeat(129), zoneId: ZONE_ID },
      { connectionId: "connection-1", zoneId: ZONE_ID.toUpperCase() },
      { connectionId: "connection-1", zoneId: ZONE_ID, token: "sentinel" },
      { connectionId: "connection-1", zoneId: ZONE_ID, url: "https://example.invalid" },
    ]) expectInvalid(() => parseCloudflareZoneReadIntent(invalid));
  });

  it("consumes the Protocol-owned golden corpus without defining a second observation schema", () => {
    for (const value of corpus.validSubmitRequests) expect(parseCloudflareObservationSubmitRequest(value)).toEqual(value);
    for (const value of corpus.invalidSubmitRequests) expectInvalid(() => parseCloudflareObservationSubmitRequest(value));
  });

  it("keeps denied/provider diagnostics local and retry shape closed", () => {
    for (const code of ["denied", "authentication", "permission", "temporarily_unavailable", "invalid_response", "response_too_large"] as const) {
      expect(parseCloudflareObservationError({ code, retryAfterSeconds: null })).toEqual({ code, retryAfterSeconds: null });
    }
    expect(parseCloudflareObservationError({ code: "rate_limited", retryAfterSeconds: null })).toEqual({ code: "rate_limited", retryAfterSeconds: null });
    expect(parseCloudflareObservationError({ code: "rate_limited", retryAfterSeconds: 86_400 })).toEqual({ code: "rate_limited", retryAfterSeconds: 86_400 });
    for (const invalid of [
      { code: "invalid_observation", retryAfterSeconds: null },
      { code: "permission", retryAfterSeconds: 1 },
      { code: "rate_limited", retryAfterSeconds: -1 },
      { code: "rate_limited", retryAfterSeconds: 86_401 },
    ]) expectInvalid(() => parseCloudflareObservationError(invalid));
  });

  it("rejects accessors, symbols, custom prototypes and cycles without disclosure", () => {
    let getterCalled = false;
    const accessor = { connectionId: "connection-1", zoneId: ZONE_ID };
    Object.defineProperty(accessor, "token", { enumerable: true, get() { getterCalled = true; return "sentinel"; } });
    expectInvalid(() => parseCloudflareZoneReadIntent(accessor));
    expect(getterCalled).toBe(false);
    expectInvalid(() => parseCloudflareZoneReadIntent({ connectionId: "connection-1", zoneId: ZONE_ID, [Symbol("hidden")]: true }));
    expectInvalid(() => parseCloudflareZoneReadIntent(Object.assign(Object.create({ inherited: true }), { connectionId: "connection-1", zoneId: ZONE_ID })));
    const cycle: Record<string, unknown> = { connectionId: "connection-1", zoneId: ZONE_ID }; cycle.self = cycle;
    expectInvalid(() => parseCloudflareZoneReadIntent(cycle));
  });
});
