import { createHash, type KeyObject, verify } from "node:crypto";

import {
  bootstrapCapabilityEnvelopeSchema,
  encodeBootstrapCapabilitySignatureTranscript,
  encodeBootstrapCapabilitySignedEnvelope,
  type BootstrapCapabilityEnvelope,
} from "@gooddealer/protocol/devices";

export const BOOTSTRAP_CAPABILITY_KEY_PURPOSE =
  "gooddealer.devices.bootstrap-capability.v1" as const;

export interface BootstrapVerificationKeySource {
  findVerificationKey(input: {
    readonly purpose: typeof BOOTSTRAP_CAPABILITY_KEY_PURPOSE;
    readonly kid: string;
  }): Promise<KeyObject | null>;
}

/** Production authority. It has no configuration seam and can never return a key. */
export class DenyingBootstrapVerificationKeySource implements BootstrapVerificationKeySource {
  async findVerificationKey(): Promise<null> {
    return null;
  }
}

export interface BootstrapCapabilityExpectedBinding {
  readonly accountId: string;
  readonly deviceId: string;
  readonly accountSecurityEpoch: number;
  readonly jti: string;
  readonly deviceSwitchRequestId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly evaluatedAt: string;
}

export type BootstrapCapabilityAdmission =
  | { readonly accepted: true; readonly presentation: VerifiedBootstrapCapabilityPresentation }
  | { readonly accepted: false; readonly code: "CAPABILITY_INVALID" };

const presentationBrand: unique symbol = Symbol("verified bootstrap capability presentation");

/** Module-private authority. Structural lookalikes cannot enter the persistence service. */
export class VerifiedBootstrapCapabilityPresentation {
  readonly envelope: BootstrapCapabilityEnvelope;
  readonly canonicalSignedEnvelope: Uint8Array;
  readonly signedEnvelopeDigest: Uint8Array;
  readonly #owner: object;
  readonly [presentationBrand] = true;

  constructor(owner: object, envelope: BootstrapCapabilityEnvelope) {
    this.#owner = owner;
    this.envelope = envelope;
    this.canonicalSignedEnvelope = encodeBootstrapCapabilitySignedEnvelope(envelope);
    this.signedEnvelopeDigest = createHash("sha256").update(this.canonicalSignedEnvelope).digest();
  }

  isOwnedBy(owner: object): boolean {
    return this.#owner === owner;
  }
}

/** Internal verifier. Fixture key injection is deliberately not re-exported by devices/index. */
export class BootstrapCapabilityVerifier {
  readonly #owner = Object.freeze({});

  constructor(private readonly keys: BootstrapVerificationKeySource) {}

  async verify(
    presented: unknown,
    expected: BootstrapCapabilityExpectedBinding,
  ): Promise<BootstrapCapabilityAdmission> {
    const copied = copyBoundedWireValue(presented);
    if (copied === null) return denied();
    const parsed = bootstrapCapabilityEnvelopeSchema.safeParse(copied);
    if (!parsed.success) return denied();
    const envelope = parsed.data;
    const signature = decodeCanonicalBase64Url(envelope.signature);
    if (signature === null || signature.byteLength !== 64) return denied();

    const key = await this.keys.findVerificationKey({
      purpose: BOOTSTRAP_CAPABILITY_KEY_PURPOSE,
      kid: envelope.kid,
    });
    if (key === null || key.type !== "public" || key.asymmetricKeyType !== "ed25519") return denied();
    let valid = false;
    try {
      valid = verify(null, encodeBootstrapCapabilitySignatureTranscript(envelope), key, signature);
    } catch {
      return denied();
    }
    if (!valid || !bindingMatches(envelope, expected)) return denied();
    return {
      accepted: true,
      presentation: new VerifiedBootstrapCapabilityPresentation(this.#owner, envelope),
    };
  }

  owns(presentation: VerifiedBootstrapCapabilityPresentation): boolean {
    return presentation.isOwnedBy(this.#owner);
  }
}

function bindingMatches(
  envelope: BootstrapCapabilityEnvelope,
  expected: BootstrapCapabilityExpectedBinding,
): boolean {
  const evaluatedAt = Date.parse(expected.evaluatedAt);
  return Number.isFinite(evaluatedAt) &&
    envelope.accountId === expected.accountId &&
    envelope.deviceId === expected.deviceId &&
    envelope.accountSecurityEpoch === expected.accountSecurityEpoch &&
    envelope.jti === expected.jti &&
    envelope.payload.deviceSwitchRequestId === expected.deviceSwitchRequestId &&
    envelope.issuedAt === expected.issuedAt &&
    envelope.expiresAt === expected.expiresAt &&
    Date.parse(envelope.issuedAt) <= evaluatedAt &&
    evaluatedAt < Date.parse(envelope.expiresAt);
}

function decodeCanonicalBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.includes("=")) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.toString("base64url") === value ? decoded : null;
  } catch {
    return null;
  }
}

function denied(): BootstrapCapabilityAdmission {
  return { accepted: false, code: "CAPABILITY_INVALID" };
}

export function copyBoundedWireValue(value: unknown): unknown | null {
  const budget = { properties: 0, bytes: 0 };
  return copyWireValue(value, budget, 0);
}

function copyWireValue(
  value: unknown,
  budget: { properties: number; bytes: number },
  depth: number,
): unknown | null {
  if (depth > 12 || budget.properties > 256 || budget.bytes > 65_536) return null;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value === "string") {
    budget.bytes += Buffer.byteLength(value, "utf8");
    return budget.bytes <= 65_536 && value.length <= 16_384 ? value : null;
  }
  if (typeof value !== "object") return null;

  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || value.length > 256) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)))) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return null;
      budget.properties += 1;
      const copied = copyWireValue(descriptor.value, budget, depth + 1);
      if (copied === null && descriptor.value !== null) return null;
      result.push(copied);
    }
    return result;
  }
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key as string];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return null;
    budget.properties += 1;
    const copied = copyWireValue(descriptor.value, budget, depth + 1);
    if (copied === null && descriptor.value !== null) return null;
    result[key as string] = copied;
  }
  return result;
}
