import { createPublicKey } from "node:crypto";

import { identifier } from "@gooddealer/protocol/wire";

import type { OpenBaoTransitSigningKey } from "./openbao-transit-signer";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_PUBLIC_KEY_BYTES = 32;

export interface DesktopAuthorizationVerifierRegistry {
  readonly schemaVersion: 1;
  readonly keys: readonly DesktopAuthorizationVerifierRegistryKey[];
}

export interface DesktopAuthorizationVerifierRegistryKey {
  readonly purpose: "grant_v3" | "active_device_lease_v1";
  readonly keyId: string;
  readonly publicKey: string;
}

/**
 * Converts independently provisioned OpenBao public keys into the immutable Desktop build input.
 * Private material and OpenBao credentials never cross this build boundary.
 */
export function createDesktopAuthorizationVerifierRegistry(input: {
  readonly grantKeys: readonly Pick<OpenBaoTransitSigningKey, "kid" | "publicKeyPem">[];
  readonly leaseKeys: readonly Pick<OpenBaoTransitSigningKey, "kid" | "publicKeyPem">[];
}): DesktopAuthorizationVerifierRegistry {
  const grantKeys = preparePurposeKeys(input.grantKeys, "grant_v3");
  const leaseKeys = preparePurposeKeys(input.leaseKeys, "active_device_lease_v1");
  rejectCrossPurposeDuplicates(grantKeys, leaseKeys);
  return {
    schemaVersion: 1,
    keys: [...grantKeys, ...leaseKeys],
  };
}

export function serializeDesktopAuthorizationVerifierRegistry(input: {
  readonly grantKeys: readonly Pick<OpenBaoTransitSigningKey, "kid" | "publicKeyPem">[];
  readonly leaseKeys: readonly Pick<OpenBaoTransitSigningKey, "kid" | "publicKeyPem">[];
}): string {
  return JSON.stringify(createDesktopAuthorizationVerifierRegistry(input));
}

function preparePurposeKeys(
  values: readonly Pick<OpenBaoTransitSigningKey, "kid" | "publicKeyPem">[],
  purpose: DesktopAuthorizationVerifierRegistryKey["purpose"],
): DesktopAuthorizationVerifierRegistryKey[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 8) {
    throw new TypeError("Desktop authorization verifier keys are invalid");
  }
  const keys = values.map((value) => ({
    purpose,
    keyId: identifier.parse(value.kid),
    publicKey: rawEd25519PublicKey(value.publicKeyPem).toString("base64url"),
  }));
  const keyIds = new Set(keys.map((key) => key.keyId));
  const publicKeys = new Set(keys.map((key) => key.publicKey));
  if (keyIds.size !== keys.length || publicKeys.size !== keys.length) {
    throw new TypeError("Desktop authorization verifier keys are duplicated");
  }
  return keys;
}

function rejectCrossPurposeDuplicates(
  grantKeys: readonly DesktopAuthorizationVerifierRegistryKey[],
  leaseKeys: readonly DesktopAuthorizationVerifierRegistryKey[],
): void {
  const grantKeyIds = new Set(grantKeys.map((key) => key.keyId));
  const grantPublicKeys = new Set(grantKeys.map((key) => key.publicKey));
  if (leaseKeys.some((key) => grantKeyIds.has(key.keyId))) {
    throw new TypeError("Desktop authorization key IDs must be purpose-separated");
  }
  if (leaseKeys.some((key) => grantPublicKeys.has(key.publicKey))) {
    throw new TypeError("Desktop authorization public keys must be purpose-separated");
  }
}

function rawEd25519PublicKey(publicKeyPem: string): Buffer {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") throw new Error();
    const spki = key.export({ format: "der", type: "spki" });
    if (
      !Buffer.isBuffer(spki)
      || spki.length !== ED25519_SPKI_PREFIX.length + ED25519_PUBLIC_KEY_BYTES
      || !spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
    ) throw new Error();
    return Buffer.from(spki.subarray(ED25519_SPKI_PREFIX.length));
  } catch {
    throw new TypeError("Desktop authorization public key must be Ed25519");
  }
}
