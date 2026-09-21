import { verify, type KeyObject } from "node:crypto";

import {
  activeDeviceLeaseEnvelopeSchema,
  encodeActiveDeviceLeaseSignatureTranscript,
  type ActiveDeviceLeaseEnvelope,
} from "@gooddealer/protocol/devices";
import { identifier } from "@gooddealer/protocol/wire";

export interface ActiveDeviceLeaseVerifier {
  verify(value: unknown): ActiveDeviceLeaseEnvelope | null;
}

export interface TrustedActiveDeviceLeaseVerificationKey {
  readonly kid: string;
  readonly publicKey: KeyObject;
}

/** Verifies only ActiveDeviceLease v1 envelopes against the configured purpose-specific trust roots. */
export class TrustedActiveDeviceLeaseVerifier implements ActiveDeviceLeaseVerifier {
  readonly #keys: ReadonlyMap<string, KeyObject>;

  constructor(keys: readonly TrustedActiveDeviceLeaseVerificationKey[]) {
    const trusted = new Map<string, KeyObject>();
    for (const candidate of keys) {
      const kid = identifier.parse(candidate.kid);
      if (candidate.publicKey.type !== "public" || candidate.publicKey.asymmetricKeyType !== "ed25519") {
        throw new TypeError("ActiveDeviceLease verification key must be Ed25519 public material");
      }
      if (trusted.has(kid)) throw new TypeError("ActiveDeviceLease verification key id is duplicated");
      trusted.set(kid, candidate.publicKey);
    }
    if (trusted.size === 0) throw new TypeError("ActiveDeviceLease verification keys are unavailable");
    this.#keys = trusted;
  }

  verify(value: unknown): ActiveDeviceLeaseEnvelope | null {
    const parsed = activeDeviceLeaseEnvelopeSchema.safeParse(value);
    if (!parsed.success) return null;
    const envelope = parsed.data;
    const key = this.#keys.get(envelope.kid);
    if (key === undefined) return null;
    try {
      return verify(
        null,
        encodeActiveDeviceLeaseSignatureTranscript(envelope),
        key,
        Buffer.from(envelope.signature, "base64url"),
      ) ? envelope : null;
    } catch {
      return null;
    }
  }
}

export class DenyingActiveDeviceLeaseVerifier implements ActiveDeviceLeaseVerifier {
  verify(): null {
    return null;
  }
}
