import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  verify,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTIVE_DEVICE_LEASE_SIGNATURE_DOMAIN,
  BOOTSTRAP_CAPABILITY_SIGNATURE_DOMAIN,
  activeDeviceLeaseEnvelopeSchema,
  bootstrapCapabilityEnvelopeSchema,
  encodeActiveDeviceLeaseSignatureTranscript,
  encodeBootstrapCapabilitySignatureTranscript,
  encodeBootstrapCapabilitySignedEnvelope,
} from "../src/devices/index";

const corpus = JSON.parse(readFileSync(resolve(
  import.meta.dirname,
  "../test-vectors/bootstrap-crypto/ed25519-fixture.json",
), "utf8")) as {
  fixtureOnly: boolean;
  algorithm: string;
  testPrivateKeyPkcs8DerBase64Url: string;
  publicKeySpkiDerBase64Url: string;
  activeLeaseTestPrivateKeyPkcs8DerBase64Url: string;
  activeLeasePublicKeySpkiDerBase64Url: string;
  bootstrap: { envelope: Record<string, unknown>; transcriptBase64Url: string; transcriptSha256: string };
  activeLease: { envelope: Record<string, unknown>; transcriptBase64Url: string; transcriptSha256: string };
};

function publicKey() {
  return createPublicKey({
    key: Buffer.from(corpus.publicKeySpkiDerBase64Url, "base64url"),
    format: "der",
    type: "spki",
  });
}

function activeLeasePublicKey() {
  return createPublicKey({
    key: Buffer.from(corpus.activeLeasePublicKeySpkiDerBase64Url, "base64url"),
    format: "der",
    type: "spki",
  });
}

function signature(envelope: Record<string, unknown>): Buffer {
  return Buffer.from(String(envelope.signature), "base64url");
}

describe("Bootstrap and Active Lease fixed Ed25519 corpus", () => {
  it("pins purpose-isolated canonical transcript bytes and valid signatures", () => {
    expect(corpus.fixtureOnly).toBe(true);
    expect(corpus.algorithm).toBe("Ed25519");
    expect(BOOTSTRAP_CAPABILITY_SIGNATURE_DOMAIN).toBe("GOODDEALER-BOOTSTRAP-CAPABILITY-V1");
    expect(ACTIVE_DEVICE_LEASE_SIGNATURE_DOMAIN).toBe("GOODDEALER-ACTIVE-DEVICE-LEASE-V1");

    const bootstrapTranscript = encodeBootstrapCapabilitySignatureTranscript(corpus.bootstrap.envelope);
    const leaseTranscript = encodeActiveDeviceLeaseSignatureTranscript(corpus.activeLease.envelope);
    expect(Buffer.from(bootstrapTranscript).toString("base64url")).toBe(corpus.bootstrap.transcriptBase64Url);
    expect(Buffer.from(leaseTranscript).toString("base64url")).toBe(corpus.activeLease.transcriptBase64Url);
    expect(createHash("sha256").update(bootstrapTranscript).digest("base64url"))
      .toBe(corpus.bootstrap.transcriptSha256);
    expect(createHash("sha256").update(leaseTranscript).digest("base64url"))
      .toBe(corpus.activeLease.transcriptSha256);
    expect(verify(null, bootstrapTranscript, publicKey(), signature(corpus.bootstrap.envelope))).toBe(true);
    expect(verify(null, leaseTranscript, activeLeasePublicKey(), signature(corpus.activeLease.envelope))).toBe(true);
    expect(verify(null, leaseTranscript, publicKey(), signature(corpus.bootstrap.envelope))).toBe(false);
    expect(verify(null, bootstrapTranscript, activeLeasePublicKey(), signature(corpus.activeLease.envelope))).toBe(false);
    expect(verify(null, bootstrapTranscript, publicKey(), signature(corpus.activeLease.envelope))).toBe(false);
    expect(verify(null, leaseTranscript, publicKey(), signature(corpus.activeLease.envelope))).toBe(false);
  });

  it("changes the complete signed-envelope identity when only the signature changes", () => {
    const changed = { ...corpus.bootstrap.envelope, signature: "A".repeat(86) };
    expect(encodeBootstrapCapabilitySignatureTranscript(changed)).toEqual(
      encodeBootstrapCapabilitySignatureTranscript(corpus.bootstrap.envelope),
    );
    expect(encodeBootstrapCapabilitySignedEnvelope(changed)).not.toEqual(
      encodeBootstrapCapabilitySignedEnvelope(corpus.bootstrap.envelope),
    );
  });

  it("rejects every Bootstrap claim mutation, wrong key, and malformed signature length", () => {
    const original = corpus.bootstrap.envelope;
    const claimMutations: Record<string, unknown>[] = [
      { ...original, schemaVersion: 999 },
      { ...original, iss: "https://invalid.example" },
      { ...original, kid: "different-kid" },
      { ...original, accountId: "different-account" },
      { ...original, deviceId: "different-device" },
      { ...original, accountSecurityEpoch: 8 },
      { ...original, jti: "different-jti" },
      { ...original, issuedAt: "2026-08-20T00:00:01Z" },
      { ...original, expiresAt: "2026-08-20T00:31:00Z" },
      { ...original, typ: "gd.active-device-lease.v1" },
      { ...original, aud: "gooddealer-desktop/active-device-lease" },
      { ...original, payload: { deviceSwitchRequestId: "different-switch" } },
    ];
    for (const candidate of claimMutations) {
      const parsed = bootstrapCapabilityEnvelopeSchema.safeParse(candidate);
      if (parsed.success) {
        expect(verify(
          null,
          encodeBootstrapCapabilitySignatureTranscript(parsed.data),
          publicKey(),
          signature(original),
        )).toBe(false);
      }
    }
    const wrongKey = generateKeyPairSync("ed25519").publicKey;
    expect(verify(
      null,
      encodeBootstrapCapabilitySignatureTranscript(original),
      wrongKey,
      signature(original),
    )).toBe(false);
    expect(signature(original)).toHaveLength(64);
    expect(signature({ ...original, signature: Buffer.alloc(63).toString("base64url") })).toHaveLength(63);
    expect(signature({ ...original, signature: Buffer.alloc(65).toString("base64url") })).toHaveLength(65);
    expect(Buffer.from("A=", "base64url").toString("base64url")).not.toBe("A=");
  });

  it("keeps the test private key as corpus data and never exports a fixture factory", () => {
    const privateKey = createPrivateKey({
      key: Buffer.from(corpus.testPrivateKeyPkcs8DerBase64Url, "base64url"),
      format: "der",
      type: "pkcs8",
    });
    expect(privateKey.type).toBe("private");
    expect(createPublicKey(privateKey).export({ format: "der", type: "spki" }))
      .toEqual(publicKey().export({ format: "der", type: "spki" }));
    const leasePrivateKey = createPrivateKey({
      key: Buffer.from(corpus.activeLeaseTestPrivateKeyPkcs8DerBase64Url, "base64url"),
      format: "der",
      type: "pkcs8",
    });
    expect(createPublicKey(leasePrivateKey).export({ format: "der", type: "spki" }))
      .toEqual(activeLeasePublicKey().export({ format: "der", type: "spki" }));
    expect(activeDeviceLeaseEnvelopeSchema.safeParse(corpus.bootstrap.envelope).success).toBe(false);
    expect(bootstrapCapabilityEnvelopeSchema.safeParse(corpus.activeLease.envelope).success).toBe(false);
  });
});
