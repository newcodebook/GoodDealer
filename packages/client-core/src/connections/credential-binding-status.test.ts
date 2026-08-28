import { describe, expect, it } from "vitest";

import { parseRedactedCredentialBindingStatus } from "./index";

const validStatus = {
  schemaVersion: 1,
  bindingId: "binding-a",
  providerConnectionId: "connection-a",
  deviceId: "device-a",
  provider: "fixture",
  credentialProfileId: "fixture-api-v1",
  credentialProfileVersion: 1,
  fingerprint: "sha256:0123456789abcdef",
  credentialHealth: "healthy",
  healthGeneration: 4,
  bindingVersion: 7,
} as const;

describe("redacted credential binding status boundary", () => {
  it("parses the exact whitelist-only redacted status", () => {
    expect(parseRedactedCredentialBindingStatus(validStatus)).toEqual(validStatus);
    expect(
      parseRedactedCredentialBindingStatus(Object.assign(Object.create(null), validStatus)),
    ).toEqual(validStatus);
  });

  it("rejects every secret reference and authority-shaped field", () => {
    const forbidden = [
      "credentialRef",
      "slots",
      "secretKind",
      "apiKey",
      "accessToken",
      "refreshToken",
      "clientSecret",
      "authorization",
      "headers",
      "body",
      "scope",
      "runtimeMode",
    ];
    for (const field of forbidden) {
      expect(() => parseRedactedCredentialBindingStatus({ ...validStatus, [field]: "forbidden" }))
        .toThrow("invalid credential binding status");
    }
  });

  it("does not echo secret or reference canaries in errors", () => {
    const secretCanary = "GOODDEALER_SECRET_CANARY_P024_7f4c9b28";
    const referenceCanary = "GOODDEALER_CREDENTIAL_REF_CANARY_P024_d390c1e7";
    for (const canary of [secretCanary, referenceCanary]) {
      let error: unknown;
      try {
        parseRedactedCredentialBindingStatus({ ...validStatus, unknown: canary });
      } catch (caught) {
        error = caught;
      }
      expect(String(error)).not.toContain(canary);
    }
  });

  it("rejects inherited custom prototype and missing-own fields", () => {
    const inherited = Object.create(validStatus) as object;
    expect(() => parseRedactedCredentialBindingStatus(inherited)).toThrow(
      "invalid credential binding status",
    );
    const custom = Object.assign(Object.create({ inherited: true }), validStatus) as object;
    expect(() => parseRedactedCredentialBindingStatus(custom)).toThrow(
      "invalid credential binding status",
    );
    const { bindingId: _missing, ...missingOwn } = validStatus;
    expect(() => parseRedactedCredentialBindingStatus(missingOwn)).toThrow(
      "invalid credential binding status",
    );
  });

  it("rejects accessors and symbols before executing getters", () => {
    let getterCalls = 0;
    const accessor = { ...validStatus } as Record<string, unknown>;
    Object.defineProperty(accessor, "bindingId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "binding-a";
      },
    });
    expect(() => parseRedactedCredentialBindingStatus(accessor)).toThrow(
      "invalid credential binding status",
    );
    expect(getterCalls).toBe(0);
    expect(() =>
      parseRedactedCredentialBindingStatus({ ...validStatus, [Symbol("secret")]: "hidden" }),
    ).toThrow("invalid credential binding status");
  });

  it("rejects invalid generations identifiers fingerprints and health", () => {
    const invalid: unknown[] = [
      { ...validStatus, healthGeneration: 0 },
      { ...validStatus, bindingVersion: Number.MAX_SAFE_INTEGER + 1 },
      { ...validStatus, bindingId: "contains space" },
      { ...validStatus, fingerprint: "short" },
      { ...validStatus, credentialHealth: "unknown-health" },
      { ...validStatus, credentialProfileVersion: 0 },
    ];
    for (const candidate of invalid) {
      expect(() => parseRedactedCredentialBindingStatus(candidate)).toThrow(
        "invalid credential binding status",
      );
    }
  });
});
