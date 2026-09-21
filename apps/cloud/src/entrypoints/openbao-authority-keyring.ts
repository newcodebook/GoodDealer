import { createPublicKey } from "node:crypto";

import { identifier } from "@gooddealer/protocol/wire";

import type { OpenBaoTransitSigningKey } from "./openbao-transit-signer";

const MAXIMUM_VERIFIER_KEYS_PER_PURPOSE = 8;

export interface OpenBaoTransitPurposeKeyring {
  readonly activeKey: OpenBaoTransitSigningKey;
  readonly verifierKeys: readonly OpenBaoTransitSigningKey[];
}

export interface OpenBaoAuthorityKeyConfiguration {
  readonly address: string;
  readonly transitMount: string;
  readonly grant: OpenBaoTransitPurposeKeyring;
  readonly lease: OpenBaoTransitPurposeKeyring;
}

interface ActiveKeyReference {
  readonly name: string;
  readonly version: number;
  readonly kid: string;
}

/** Strictly admits the independently provisioned public keyring used by the Cloud composition root. */
export function parseOpenBaoAuthorityKeyConfiguration(value: unknown): OpenBaoAuthorityKeyConfiguration {
  const root = exactRecord(value, ["schemaVersion", "address", "transitMount", "grant", "lease"]);
  if (root.schemaVersion !== 1 || typeof root.address !== "string" || typeof root.transitMount !== "string") {
    throw new TypeError("OpenBao public-key configuration is invalid");
  }
  const grant = parsePurposeKeyring(root.grant, "Grant");
  const lease = parsePurposeKeyring(root.lease, "Lease");
  rejectDuplicateAuthority(grant, lease);
  return {
    address: root.address,
    transitMount: root.transitMount,
    grant,
    lease,
  };
}

function parsePurposeKeyring(value: unknown, label: string): OpenBaoTransitPurposeKeyring {
  const keyring = exactRecord(value, ["active", "verifierKeys"]);
  const active = parseActiveKeyReference(keyring.active);
  if (!Array.isArray(keyring.verifierKeys)
    || keyring.verifierKeys.length < 1
    || keyring.verifierKeys.length > MAXIMUM_VERIFIER_KEYS_PER_PURPOSE) {
    throw new TypeError(`OpenBao ${label} verifier keyring is invalid`);
  }
  const verifierKeys = keyring.verifierKeys.map(parseSigningKey);
  const coordinates = new Set<string>();
  const kids = new Set<string>();
  const materials = new Set<string>();
  for (const key of verifierKeys) {
    const coordinate = `${key.name}\u0000${key.version}`;
    const material = publicKeyDer(key.publicKeyPem).toString("base64url");
    if (coordinates.has(coordinate) || kids.has(key.kid) || materials.has(material)) {
      throw new TypeError(`OpenBao ${label} verifier keys are duplicated`);
    }
    coordinates.add(coordinate);
    kids.add(key.kid);
    materials.add(material);
  }
  const activeKeys = verifierKeys.filter((key) => key.name === active.name
    && key.version === active.version && key.kid === active.kid);
  if (activeKeys.length !== 1) throw new TypeError(`OpenBao ${label} active signing key is invalid`);
  return Object.freeze({
    activeKey: activeKeys[0]!,
    verifierKeys: Object.freeze(verifierKeys),
  });
}

function parseActiveKeyReference(value: unknown): ActiveKeyReference {
  const active = exactRecord(value, ["name", "version", "kid"]);
  return {
    name: pathSegment(active.name, "OpenBao Transit key name"),
    version: keyVersion(active.version),
    kid: identifier.parse(active.kid),
  };
}

function parseSigningKey(value: unknown): OpenBaoTransitSigningKey {
  const key = exactRecord(value, ["name", "version", "kid", "publicKeyPem"]);
  if (typeof key.publicKeyPem !== "string") {
    throw new TypeError("OpenBao public-key configuration is invalid");
  }
  const publicKeyPem = normalizeTransitPublicKey(key.publicKeyPem);
  publicKeyDer(publicKeyPem);
  return Object.freeze({
    name: pathSegment(key.name, "OpenBao Transit key name"),
    version: keyVersion(key.version),
    kid: identifier.parse(key.kid),
    publicKeyPem,
  });
}

function rejectDuplicateAuthority(
  grant: OpenBaoTransitPurposeKeyring,
  lease: OpenBaoTransitPurposeKeyring,
): void {
  const grantNames = new Set(grant.verifierKeys.map((key) => key.name));
  const grantKids = new Set(grant.verifierKeys.map((key) => key.kid));
  const grantMaterials = new Set(grant.verifierKeys.map((key) => publicKeyDer(key.publicKeyPem).toString("base64url")));
  if (lease.verifierKeys.some((key) => grantNames.has(key.name)
    || grantKids.has(key.kid)
    || grantMaterials.has(publicKeyDer(key.publicKeyPem).toString("base64url")))) {
    throw new TypeError("OpenBao Grant and Lease keys must be purpose-separated");
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("OpenBao public-key configuration is invalid");
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError("OpenBao public-key configuration is invalid");
  }
  return record;
}

function pathSegment(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function keyVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError("OpenBao Transit key version is invalid");
  }
  return Number(value);
}

function normalizeTransitPublicKey(value: string): string {
  if (value.startsWith("-----BEGIN PUBLIC KEY-----\n")) return value;
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(value)) {
    throw new TypeError("OpenBao Transit public key is invalid");
  }
  const raw = Buffer.from(value, "base64");
  if (raw.length !== 32 || raw.toString("base64") !== value) {
    throw new TypeError("OpenBao Transit public key is invalid");
  }
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
  return createPublicKey({ key: spki, format: "der", type: "spki" })
    .export({ format: "pem", type: "spki" }).toString();
}

function publicKeyDer(value: string): Buffer {
  try {
    const key = createPublicKey(value);
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") throw new Error();
    return Buffer.from(key.export({ format: "der", type: "spki" }));
  } catch {
    throw new TypeError("OpenBao Transit public key must be Ed25519");
  }
}
