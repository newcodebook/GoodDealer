import { describe, expect, it } from "vitest";

import { parsePorkbunRegistrarStatus, porkbunRegistrarIntentSchema } from "./porkbun-registrar";

const connectionId = "11111111-1111-4111-a111-111111111111";

function status(lastOperation: unknown) {
  return {
    schemaVersion: 1,
    observeQualified: false,
    observeEntitled: true,
    dnsObserve: { qualified: false, entitled: true },
    capturable: true,
    laneState: "ready",
    connections: [],
    lastOperation,
  };
}

describe("Porkbun registrar contract", () => {
  it("accepts a delegation read only for a canonical domain and a known connection", () => {
    expect(porkbunRegistrarIntentSchema.safeParse({
      schemaVersion: 1, action: "observe-delegation", connectionId, domain: "example.test",
    }).success).toBe(true);
    for (const intent of [
      { schemaVersion: 1, action: "observe-delegation", connectionId, domain: "Example.test" },
      { schemaVersion: 1, action: "observe-delegation", connectionId: connectionId.toUpperCase(), domain: "example.test" },
      { schemaVersion: 1, action: "observe-delegation", connectionId, domain: "example.test", nameservers: [] },
      { schemaVersion: 1, action: "observe-delegation", connectionId },
    ]) {
      expect(porkbunRegistrarIntentSchema.safeParse(intent).success).toBe(false);
    }
  });

  it("ties domain refusals to the per-domain reads and answered-elsewhere to the DNS read", () => {
    for (const outcome of ["confirmed", "api_access_disabled", "not_in_account", "domain_not_active"]) {
      expect(() => parsePorkbunRegistrarStatus(status({ kind: "porkbun_delegation_observe", outcome }))).not.toThrow();
    }
    for (const operation of [
      { kind: "porkbun_delegation_observe", outcome: "answered_elsewhere" },
      { kind: "porkbun_refresh", outcome: "not_in_account" },
      { kind: "porkbun_refresh", outcome: "answered_elsewhere" },
      { kind: "porkbun_delegation", outcome: "confirmed" },
    ]) {
      expect(() => parsePorkbunRegistrarStatus(status(operation))).toThrow(TypeError);
    }
  });
});
