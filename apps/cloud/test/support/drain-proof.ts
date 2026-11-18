import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

import { DRAIN_STREAM_GENESIS_DIGEST, encodeDrainProofSignatureTranscript } from "@gooddealer/protocol/execution-events";

const empty = { lastAssignedSequence: 0, contiguousReceivedThrough: 0, pendingCount: 0, rollingDigest: DRAIN_STREAM_GENESIS_DIGEST };

export function drainProofKeyPair(): { privateKey: KeyObject; rawPublicKey: Buffer } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, rawPublicKey: publicKey.export({ format: "der", type: "spki" }).subarray(-32) };
}

/**
 * A v2 handoff drain proof signed over the protocol's own transcript, so tests exercise the real
 * signature domain. Mutation carries two entries; the other two streams are empty at genesis.
 */
export function signedHandoffDrainProof(
  privateKey: KeyObject,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const unsigned = {
    schemaVersion: 2, typ: "gd.drain-proof.v2", canonicalCodecVersion: 2,
    aud: "gooddealer-cloud/drain-verification", proofId: "proof-1", workspaceId: "workspace-drain",
    sourceDeviceId: "device-old", activeLeaseEpoch: 1,
    streams: [
      { stream: "mutation", ...empty, lastAssignedSequence: 2, contiguousReceivedThrough: 2, rollingDigest: "M".repeat(43) },
      { stream: "execution_fact", ...empty },
      { stream: "device_audit", ...empty },
    ],
    digestAlgorithm: "sha256-chain-v1", issuedAt: "2026-11-17T00:00:00Z", expiresAt: "2026-11-17T00:05:00Z",
    signingKeyId: "key-old", signingKeyVersion: 1, signatureTranscriptVersion: 1, deviceSignature: "A".repeat(86),
    purpose: "handoff", deviceSwitchRequestId: "switch-1", ...overrides,
  };
  // The transcript encoder accepts the manifest shape; a hostile override is still signed as given.
  const transcript = encodeDrainProofSignatureTranscript(unsigned as never);
  return { ...unsigned, deviceSignature: sign(null, Buffer.from(transcript), privateKey).toString("base64url") };
}
