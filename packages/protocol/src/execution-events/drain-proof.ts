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

export const DRAIN_PROOF_SCHEMA_VERSION = 1 as const;
export const DRAIN_PROOF_SIGNATURE_DOMAIN = "GOODDEALER-DRAIN-PROOF-SIGNATURE-V1" as const;
export const DRAIN_PROOF_DIGEST_DOMAIN = "GOODDEALER-DRAIN-PROOF-V1" as const;

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

const drainProofCommonFields = {
  schemaVersion: z.literal(DRAIN_PROOF_SCHEMA_VERSION),
  typ: z.literal("gd.drain-proof.v1"),
  aud: z.literal("gooddealer-cloud/drain-verification"),
  proofId: identifier,
  workspaceId: identifier,
  sourceDeviceId: identifier,
  activeLeaseEpoch: safePositiveInteger,
  streams: drainStreamsSchema,
  canonicalCodecVersion: z.literal(1),
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

export const drainManifestSchema = z
  .object({
    ...drainProofCommonFields,
    purpose: z.literal("handoff"),
    deviceSwitchRequestId: identifier,
  })
  .strict()
  .superRefine(enforceProofWindow);

export const synchronizedBackupDrainProofSchema = z
  .object({
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

export const drainProofSchema = z.discriminatedUnion("purpose", [
  drainManifestSchema,
  synchronizedBackupDrainProofSchema,
]);

export function encodeDrainProofSignatureTranscript(proof: unknown): Uint8Array {
  const parsed = drainProofSchema.parse(proof);
  const { deviceSignature: _deviceSignature, ...proofWithoutDeviceSignature } = parsed;
  return encodeDomainSeparatedWireValue(DRAIN_PROOF_SIGNATURE_DOMAIN, proofWithoutDeviceSignature);
}

export function encodeDrainProofDigestInput(signedProof: unknown): Uint8Array {
  const parsed = drainProofSchema.parse(signedProof);
  const transcript = encodeDrainProofSignatureTranscript(parsed);
  const canonicalSignedProof = concatenateDrainBytes([
    transcript,
    encodeLengthPrefixedDrainBytes(encoder.encode(parsed.deviceSignature)),
  ]);
  return concatenateDrainBytes([
    encoder.encode(DRAIN_PROOF_DIGEST_DOMAIN),
    encodeLengthPrefixedDrainBytes(canonicalSignedProof),
  ]);
}

export type DrainStreamClaim = z.infer<typeof drainStreamsSchema>[number];
export type DrainProof = z.infer<typeof drainProofSchema>;
export type DrainManifest = z.infer<typeof drainManifestSchema>;
export type SynchronizedBackupDrainProof = z.infer<typeof synchronizedBackupDrainProofSchema>;
