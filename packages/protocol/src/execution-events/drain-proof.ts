import { z } from "zod";

import { sha256DigestSchema } from "../workspace/index";
import {
  base64Url,
  canonicalUtcTimestamp,
  encodeDomainSeparatedWireValue,
  identifier,
  safePositiveInteger,
  safeUnsignedInteger,
} from "../wire/index";
import {
  DRAIN_STREAM_GENESIS_DIGEST,
  concatenateDrainBytes,
  encodeLengthPrefixedDrainBytes,
} from "./streams";

const encoder = new TextEncoder();

/**
 * Schema v1 chains every mutation stream step over the frozen submitted envelope. Schema v2
 * (ADR-0030) chains the mutation stream over `encodeMutationDrainResultEnvelope` so Cloud-recorded
 * rejections can close a sequence; execution_fact and device_audit envelopes are identical in both.
 * The two versions never mix: version, `typ`, codec version, and signature/digest domains move
 * together, and a v1 proof is never upgraded or re-signed as v2.
 */
export const DRAIN_PROOF_SCHEMA_VERSION = 1 as const;
export const DRAIN_PROOF_SCHEMA_VERSION_V2 = 2 as const;
export const DRAIN_PROOF_SCHEMA_VERSIONS = [DRAIN_PROOF_SCHEMA_VERSION, DRAIN_PROOF_SCHEMA_VERSION_V2] as const;
export type DrainProofSchemaVersion = (typeof DRAIN_PROOF_SCHEMA_VERSIONS)[number];
export const DRAIN_PROOF_SIGNATURE_DOMAIN = "GOODDEALER-DRAIN-PROOF-SIGNATURE-V1" as const;
export const DRAIN_PROOF_DIGEST_DOMAIN = "GOODDEALER-DRAIN-PROOF-V1" as const;
export const DRAIN_PROOF_SIGNATURE_DOMAIN_V2 = "GOODDEALER-DRAIN-PROOF-SIGNATURE-V2" as const;
export const DRAIN_PROOF_DIGEST_DOMAIN_V2 = "GOODDEALER-DRAIN-PROOF-V2" as const;

const drainStreamClaimFields = {
  lastAssignedSequence: safeUnsignedInteger,
  contiguousReceivedThrough: safeUnsignedInteger,
  pendingCount: safeUnsignedInteger,
  rollingDigest: sha256DigestSchema,
} as const;

function drainStreamClaimSchema<Stream extends "mutation" | "execution_fact" | "device_audit">(
  stream: Stream,
) {
  return z
    .object({ stream: z.literal(stream), ...drainStreamClaimFields })
    .strict()
    .superRefine((claim, context) => {
      if (claim.contiguousReceivedThrough > claim.lastAssignedSequence) {
        context.addIssue({
          code: "custom",
          path: ["contiguousReceivedThrough"],
          message: "contiguous sequence cannot exceed the last assigned sequence",
        });
      }
      if (claim.pendingCount !== claim.lastAssignedSequence - claim.contiguousReceivedThrough) {
        context.addIssue({
          code: "custom",
          path: ["pendingCount"],
          message: "pending count must equal the unacknowledged assigned sequence count",
        });
      }
      if (claim.pendingCount !== 0) {
        context.addIssue({
          code: "custom",
          path: ["pendingCount"],
          message: "a drain proof requires every stream to be fully received",
        });
      }
      if (claim.lastAssignedSequence === 0 && claim.rollingDigest !== DRAIN_STREAM_GENESIS_DIGEST) {
        context.addIssue({
          code: "custom",
          path: ["rollingDigest"],
          message: "an empty drain stream must use the genesis digest",
        });
      }
    });
}

export const drainStreamsSchema = z.tuple([
  drainStreamClaimSchema("mutation"),
  drainStreamClaimSchema("execution_fact"),
  drainStreamClaimSchema("device_audit"),
]);

const drainProofVersionFields = {
  1: {
    schemaVersion: z.literal(DRAIN_PROOF_SCHEMA_VERSION),
    typ: z.literal("gd.drain-proof.v1"),
    canonicalCodecVersion: z.literal(1),
  },
  2: {
    schemaVersion: z.literal(DRAIN_PROOF_SCHEMA_VERSION_V2),
    typ: z.literal("gd.drain-proof.v2"),
    canonicalCodecVersion: z.literal(2),
  },
} as const;

const drainProofCommonFields = {
  aud: z.literal("gooddealer-cloud/drain-verification"),
  proofId: identifier,
  workspaceId: identifier,
  sourceDeviceId: identifier,
  activeLeaseEpoch: safePositiveInteger,
  streams: drainStreamsSchema,
  digestAlgorithm: z.literal("sha256-chain-v1"),
  issuedAt: canonicalUtcTimestamp,
  expiresAt: canonicalUtcTimestamp,
  signingKeyId: identifier,
  signingKeyVersion: safePositiveInteger,
  signatureTranscriptVersion: safePositiveInteger,
  deviceSignature: base64Url.max(1024),
} as const;

function enforceProofWindow(
  proof: { readonly issuedAt: string; readonly expiresAt: string },
  context: z.RefinementCtx,
) {
  if (proof.issuedAt >= proof.expiresAt) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "drain proof expiry must be later than issuance",
    });
  }
}

function drainManifestSchemaFor(version: DrainProofSchemaVersion) {
  return z
    .object({
      ...drainProofVersionFields[version],
      ...drainProofCommonFields,
      purpose: z.literal("handoff"),
      deviceSwitchRequestId: identifier,
    })
    .strict()
    .superRefine(enforceProofWindow);
}

function synchronizedBackupDrainProofSchemaFor(version: DrainProofSchemaVersion) {
  return z
    .object({
      ...drainProofVersionFields[version],
      ...drainProofCommonFields,
      purpose: z.literal("synchronized_backup"),
      synchronizedSnapshotBinding: z
        .object({
          localCommitSequence: safeUnsignedInteger,
          serverRevision: safeUnsignedInteger,
        })
        .strict(),
    })
    .strict()
    .superRefine(enforceProofWindow);
}

export const drainManifestSchema = z.union([drainManifestSchemaFor(1), drainManifestSchemaFor(2)]);

export const synchronizedBackupDrainProofSchema = z.union([
  synchronizedBackupDrainProofSchemaFor(1),
  synchronizedBackupDrainProofSchemaFor(2),
]);

export const drainProofSchema = z.union([drainManifestSchema, synchronizedBackupDrainProofSchema]);

function proofDomains(version: DrainProofSchemaVersion) {
  return version === DRAIN_PROOF_SCHEMA_VERSION
    ? { signature: DRAIN_PROOF_SIGNATURE_DOMAIN, digest: DRAIN_PROOF_DIGEST_DOMAIN }
    : { signature: DRAIN_PROOF_SIGNATURE_DOMAIN_V2, digest: DRAIN_PROOF_DIGEST_DOMAIN_V2 };
}

export function encodeDrainProofSignatureTranscript(proof: unknown): Uint8Array {
  const parsed = drainProofSchema.parse(proof);
  const { deviceSignature: _deviceSignature, ...proofWithoutDeviceSignature } = parsed;
  return encodeDomainSeparatedWireValue(proofDomains(parsed.schemaVersion).signature, proofWithoutDeviceSignature);
}

export function encodeDrainProofDigestInput(signedProof: unknown): Uint8Array {
  const parsed = drainProofSchema.parse(signedProof);
  const transcript = encodeDrainProofSignatureTranscript(parsed);
  const canonicalSignedProof = concatenateDrainBytes([
    transcript,
    encodeLengthPrefixedDrainBytes(encoder.encode(parsed.deviceSignature)),
  ]);
  return concatenateDrainBytes([
    encoder.encode(proofDomains(parsed.schemaVersion).digest),
    encodeLengthPrefixedDrainBytes(canonicalSignedProof),
  ]);
}

export type DrainStreamClaim = z.infer<typeof drainStreamsSchema>[number];
export type DrainProof = z.infer<typeof drainProofSchema>;
export type DrainManifest = z.infer<typeof drainManifestSchema>;
export type SynchronizedBackupDrainProof = z.infer<typeof synchronizedBackupDrainProofSchema>;
