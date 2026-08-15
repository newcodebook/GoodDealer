import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AUTH_ACCESS_SIGNATURE_DOMAIN,
  AUTH_REFRESH_SIGNATURE_DOMAIN,
  DEVICE_IDENTITY_SCHEMA_VERSION,
  activeDeviceLeaseEnvelopeSchema,
  authAccessEnvelopeSchema,
  authRefreshEnvelopeSchema,
  bootstrapCapabilityEnvelopeSchema,
  deviceBindingChallengeSchema,
  encodeAuthAccessSignatureTranscript,
  encodeAuthRefreshSignatureTranscript,
  entitlementEnvelopeSchema,
  offlineDeviceLeaseEnvelopeSchema,
  signedCredentialEnvelopeSchema,
} from "../src/devices/device-identity";

const vectors = resolve(import.meta.dirname, "../test-vectors/device-identity");
const accountVectors = resolve(import.meta.dirname, "../test-vectors/account");

function vector(path: string): unknown {
  return JSON.parse(readFileSync(resolve(vectors, path), "utf8"));
}

function accountVector(path: string): unknown {
  return JSON.parse(readFileSync(resolve(accountVectors, path), "utf8"));
}

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("base64url");
}

describe("device identity contract", () => {
  it("keeps the existing device identity schema version unchanged", () => {
    expect(DEVICE_IDENTITY_SCHEMA_VERSION).toBe(1);
  });

  it("accepts a binding challenge", () => {
    expect(deviceBindingChallengeSchema.safeParse(vector("valid/binding-challenge.json")).success).toBe(true);
  });

  it("accepts a type-isolated active device lease", () => {
    expect(activeDeviceLeaseEnvelopeSchema.safeParse(vector("valid/active-device-lease.json")).success).toBe(true);
    expect(activeDeviceLeaseEnvelopeSchema.safeParse(vector("valid/entitlement.json")).success).toBe(false);
    expect(signedCredentialEnvelopeSchema.safeParse(vector("valid/entitlement.json")).success).toBe(true);
  });

  it("binds offline lease renewal to the outer access deadline", () => {
    expect(offlineDeviceLeaseEnvelopeSchema.safeParse(vector("valid/offline-device-lease.json")).success).toBe(true);
    expect(
      offlineDeviceLeaseEnvelopeSchema.safeParse(vector("invalid/offline-lease-renewal-after-access.json")).success,
    ).toBe(false);
  });

  it("separates a lifetime commercial entitlement from credential expiry", () => {
    expect(entitlementEnvelopeSchema.safeParse(vector("valid/entitlement.json")).success).toBe(true);
    expect(entitlementEnvelopeSchema.safeParse(vector("valid/entitlement-grace.json")).success).toBe(true);
    expect(
      entitlementEnvelopeSchema.safeParse(vector("invalid/entitlement-lifetime-expiry.json")).success,
    ).toBe(false);
  });

  it("accepts auth envelopes without embedding authorization scopes", () => {
    const access = accountVector("valid/auth-access-envelope.json");
    const refresh = accountVector("valid/auth-refresh-envelope.json");

    expect(authAccessEnvelopeSchema.safeParse(access).success).toBe(true);
    expect(authRefreshEnvelopeSchema.safeParse(refresh).success).toBe(true);
    expect(signedCredentialEnvelopeSchema.safeParse(access).success).toBe(true);
    expect(signedCredentialEnvelopeSchema.safeParse(refresh).success).toBe(true);
    expect(JSON.stringify(access)).not.toContain("scopes");
    expect(JSON.stringify(refresh)).not.toContain("scopes");
  });

  it("mutually rejects every signed credential across typ parser domains", () => {
    const domains = [
      {
        typ: "gd.active-device-lease.v1",
        schema: activeDeviceLeaseEnvelopeSchema,
        value: vector("valid/active-device-lease.json"),
      },
      {
        typ: "gd.offline-device-lease.v1",
        schema: offlineDeviceLeaseEnvelopeSchema,
        value: vector("valid/offline-device-lease.json"),
      },
      {
        typ: "gd.entitlement.v1",
        schema: entitlementEnvelopeSchema,
        value: vector("valid/entitlement.json"),
      },
      {
        typ: "gd.bootstrap-capability.v1",
        schema: bootstrapCapabilityEnvelopeSchema,
        value: vector("valid/bootstrap-capability.json"),
      },
      {
        typ: "gd.auth-access.v1",
        schema: authAccessEnvelopeSchema,
        value: accountVector("valid/auth-access-envelope.json"),
      },
      {
        typ: "gd.auth-refresh.v1",
        schema: authRefreshEnvelopeSchema,
        value: accountVector("valid/auth-refresh-envelope.json"),
      },
    ] as const;

    for (const parser of domains) {
      for (const candidate of domains) {
        expect(
          parser.schema.safeParse(candidate.value).success,
          `${parser.typ} parser verdict for ${candidate.typ}`,
        ).toBe(parser.typ === candidate.typ);
      }
    }
  });

  it("pins domain-separated auth signature transcript bytes and excludes signatures", () => {
    const access = accountVector("valid/auth-access-envelope.json") as Record<string, unknown>;
    const refresh = accountVector("valid/auth-refresh-envelope.json") as Record<string, unknown>;
    const accessTranscript = encodeAuthAccessSignatureTranscript(access);
    const refreshTranscript = encodeAuthRefreshSignatureTranscript(refresh);

    expect(AUTH_ACCESS_SIGNATURE_DOMAIN).toBe("GOODDEALER-AUTH-ACCESS-V1");
    expect(AUTH_REFRESH_SIGNATURE_DOMAIN).toBe("GOODDEALER-AUTH-REFRESH-V1");
    expect(digest(accessTranscript)).toBe("XAc6ar07lkfXXtTpTj9pRSCQhFUBERvWFhLVVQ3QzaI");
    expect(digest(refreshTranscript)).toBe("tJK_kXwfkt_KTcgN5DqJjPz-mPcPSKcDWjmYhH7YseI");
    expect(encodeAuthAccessSignatureTranscript({ ...access, signature: "RGlmZmVyZW50" })).toEqual(
      accessTranscript,
    );
    expect(encodeAuthRefreshSignatureTranscript({ ...refresh, signature: "RGlmZmVyZW50" })).toEqual(
      refreshTranscript,
    );
    expect(accessTranscript).not.toEqual(refreshTranscript);
  });

  for (const path of [
    "invalid/auth-access-with-mutate-scope.json",
    "invalid/auth-access-with-platform-scope.json",
    "invalid/auth-refresh-cross-typ-as-access.json",
    "invalid/auth-access-cross-typ-as-refresh.json",
    "invalid/auth-refresh-snake-case-wire.json",
    "invalid/auth-refresh-unsafe-generation.json",
    "invalid/auth-access-wrong-key-purpose.json",
    "invalid/auth-refresh-wrong-audience.json",
  ]) {
    it(`rejects account/${path}`, () => {
      expect(signedCredentialEnvelopeSchema.safeParse(accountVector(path)).success).toBe(false);
    });
  }

  for (const path of [
    "invalid/challenge-unknown-field.json",
    "invalid/challenge-version-rollback.json",
    "invalid/challenge-unsafe-key-version.json",
  ]) {
    it(`rejects ${path}`, () => {
      expect(deviceBindingChallengeSchema.safeParse(vector(path)).success).toBe(false);
    });
  }

  for (const path of [
    "invalid/credential-cross-audience.json",
    "invalid/credential-unknown-field.json",
    "invalid/credential-unknown-version.json",
    "invalid/credential-unsafe-lease-epoch.json",
    "invalid/credential-invalid-time-order.json",
    "invalid/credential-snake-case-wire.json",
    "invalid/entitlement-lifetime-expiry.json",
    "invalid/entitlement-missing-commercial-expiry.json",
    "invalid/entitlement-invalid-time.json",
    "invalid/entitlement-expiry-after-grace.json",
    "invalid/active-lease-offline-window-too-long.json",
    "invalid/offline-lease-renewal-after-access.json",
  ]) {
    it(`rejects ${path}`, () => {
      expect(signedCredentialEnvelopeSchema.safeParse(vector(path)).success).toBe(false);
    });
  }
});
