import { createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";

import {
  encodeActiveDeviceLeaseSignatureTranscript,
  type ActiveDeviceLeaseEnvelope,
} from "@gooddealer/protocol/devices";
import { describe, expect, it } from "vitest";

import { createDesktopAuthorizationVerifierRegistry } from "../src/entrypoints/desktop-authorization-registry";
import { parseOpenBaoAuthorityKeyConfiguration } from "../src/entrypoints/openbao-authority-keyring";
import { OpenBaoTransitSigner } from "../src/entrypoints/openbao-transit-signer";
import { TrustedActiveDeviceLeaseVerifier } from "../src/modules/devices/active-device-lease-verifier";
import { ACTIVE_DEVICE_LEASE_KEY_PURPOSE } from "../src/modules/devices/postgres-bootstrap-activation";

describe("OpenBao authority key rollover", () => {
  it("keeps old Lease verification while signing with the active new key and supports omission revocation", async () => {
    const oldGrant = signingKey("grant", 1, "grant-v1");
    const newGrant = signingKey("grant", 2, "grant-v2");
    const oldLease = signingKey("lease", 1, "lease-v1");
    const newLease = signingKey("lease", 2, "lease-v2");
    const configuration = parseOpenBaoAuthorityKeyConfiguration(configurationWire({
      grantKeys: [oldGrant, newGrant],
      activeGrant: newGrant,
      leaseKeys: [oldLease, newLease],
      activeLease: newLease,
    }));
    const registry = createDesktopAuthorizationVerifierRegistry({
      grantKeys: configuration.grant.verifierKeys,
      leaseKeys: configuration.lease.verifierKeys,
    });
    expect(registry.keys.map((key) => [key.purpose, key.keyId])).toEqual([
      ["grant_v3", "grant-v1"],
      ["grant_v3", "grant-v2"],
      ["active_device_lease_v1", "lease-v1"],
      ["active_device_lease_v1", "lease-v2"],
    ]);

    const claims = leaseClaims();
    const oldEnvelope = signedLease(claims, oldLease);
    const overlappingVerifier = leaseVerifier(configuration.lease.verifierKeys);
    expect(overlappingVerifier.verify(oldEnvelope)).toEqual(oldEnvelope);

    const observedRequests: Array<{ readonly url: string; readonly version: number }> = [];
    const signer = new OpenBaoTransitSigner({
      address: configuration.address,
      mount: configuration.transitMount,
      grantKey: configuration.grant.activeKey,
      leaseKey: configuration.lease.activeKey,
      tokenSource: { token: async () => "short-lived-token", invalidate: () => undefined },
      fetch: async (url, init) => {
        const request = JSON.parse(String(init.body)) as { input: string; key_version: number };
        observedRequests.push({ url, version: request.key_version });
        const signature = sign(null, Buffer.from(request.input, "base64"), newLease.privateKey);
        return jsonResponse({
          request_id: "rollover-new-lease",
          data: { signature: `vault:v2:${signature.toString("base64")}` },
        });
      },
    });
    const signed = await signer.sign({ purpose: ACTIVE_DEVICE_LEASE_KEY_PURPOSE, claims });
    expect(signed.signed).toBe(true);
    if (!signed.signed) throw new Error("active rollover signer refused Lease");
    const newEnvelope = signed.envelope as ActiveDeviceLeaseEnvelope;
    expect(newEnvelope.kid).toBe("lease-v2");
    expect(overlappingVerifier.verify(newEnvelope)).toEqual(newEnvelope);
    expect(observedRequests).toEqual([{
      url: "https://openbao.internal/v1/transit/sign/lease",
      version: 2,
    }]);

    const afterOmission = leaseVerifier([configuration.lease.activeKey]);
    expect(afterOmission.verify(oldEnvelope)).toBeNull();
    expect(afterOmission.verify(newEnvelope)).toEqual(newEnvelope);
  });

  it("rejects unknown fields, missing active keys, and duplicate coordinates, IDs, names, or material", () => {
    const grant = signingKey("grant", 1, "grant-v1");
    const lease = signingKey("lease", 1, "lease-v1");
    const valid = configurationWire({
      grantKeys: [grant],
      activeGrant: grant,
      leaseKeys: [lease],
      activeLease: lease,
    });
    expect(() => parseOpenBaoAuthorityKeyConfiguration({ ...valid, extra: true })).toThrow("invalid");
    expect(() => parseOpenBaoAuthorityKeyConfiguration({
      ...valid,
      grant: { ...valid.grant, extra: true },
    })).toThrow("invalid");
    expect(() => parseOpenBaoAuthorityKeyConfiguration({
      ...valid,
      grant: { ...valid.grant, active: { ...valid.grant.active, kid: "missing" } },
    })).toThrow("active signing key");
    expect(() => parseOpenBaoAuthorityKeyConfiguration({
      ...valid,
      grant: { ...valid.grant, verifierKeys: [grant.wire, grant.wire] },
    })).toThrow("duplicated");
    expect(() => parseOpenBaoAuthorityKeyConfiguration({
      ...valid,
      lease: {
        active: { ...valid.lease.active, kid: grant.wire.kid },
        verifierKeys: [{ ...lease.wire, kid: grant.wire.kid }],
      },
    })).toThrow("purpose-separated");
    expect(() => parseOpenBaoAuthorityKeyConfiguration({
      ...valid,
      lease: {
        active: { ...valid.lease.active, name: grant.wire.name },
        verifierKeys: [{ ...lease.wire, name: grant.wire.name }],
      },
    })).toThrow("purpose-separated");
    expect(() => parseOpenBaoAuthorityKeyConfiguration({
      ...valid,
      lease: { ...valid.lease, verifierKeys: [{ ...lease.wire, publicKeyPem: grant.wire.publicKeyPem }] },
    })).toThrow("purpose-separated");
  });
});

interface FixtureSigningKey {
  readonly wire: {
    readonly name: string;
    readonly version: number;
    readonly kid: string;
    readonly publicKeyPem: string;
  };
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
}

function signingKey(name: string, version: number, kid: string): FixtureSigningKey {
  const pair = generateKeyPairSync("ed25519");
  return {
    wire: {
      name,
      version,
      kid,
      publicKeyPem: pair.publicKey.export({ format: "pem", type: "spki" }).toString(),
    },
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
  };
}

function configurationWire(input: {
  readonly grantKeys: readonly FixtureSigningKey[];
  readonly activeGrant: FixtureSigningKey;
  readonly leaseKeys: readonly FixtureSigningKey[];
  readonly activeLease: FixtureSigningKey;
}) {
  return {
    schemaVersion: 1,
    address: "https://openbao.internal",
    transitMount: "transit",
    grant: {
      active: activeReference(input.activeGrant),
      verifierKeys: input.grantKeys.map((key) => key.wire),
    },
    lease: {
      active: activeReference(input.activeLease),
      verifierKeys: input.leaseKeys.map((key) => key.wire),
    },
  };
}

function activeReference(key: FixtureSigningKey) {
  return { name: key.wire.name, version: key.wire.version, kid: key.wire.kid };
}

function leaseClaims(): Omit<ActiveDeviceLeaseEnvelope, "kid" | "signature"> {
  return {
    schemaVersion: 1,
    typ: "gd.active-device-lease.v1",
    iss: "https://accounts.gooddealer.com",
    aud: "gooddealer-desktop/active-device-lease",
    accountId: "account-rollover",
    deviceId: "device-rollover",
    accountSecurityEpoch: 3,
    jti: "lease-rollover",
    issuedAt: "2026-09-02T00:00:00Z",
    expiresAt: "2026-09-03T00:00:00Z",
    payload: {
      leaseEpoch: 5,
      renewAfter: "2026-09-02T00:05:00Z",
      onlineExpiresAt: "2026-09-02T00:15:00Z",
      offlineExecuteUntil: "2026-09-03T00:00:00Z",
    },
  };
}

function signedLease(
  claims: Omit<ActiveDeviceLeaseEnvelope, "kid" | "signature">,
  key: FixtureSigningKey,
): ActiveDeviceLeaseEnvelope {
  const unsigned = { ...claims, kid: key.wire.kid, signature: Buffer.alloc(64).toString("base64url") };
  const signature = sign(null, encodeActiveDeviceLeaseSignatureTranscript(unsigned), key.privateKey);
  return { ...unsigned, signature: signature.toString("base64url") };
}

function leaseVerifier(keys: readonly { readonly kid: string; readonly publicKeyPem: string }[]) {
  return new TrustedActiveDeviceLeaseVerifier(keys.map((key) => ({
    kid: key.kid,
    publicKey: createPublicKey(key.publicKeyPem),
  })));
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}
