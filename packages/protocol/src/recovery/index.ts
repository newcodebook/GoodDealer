import { z } from "zod";

import {
  base64Url,
  encodeDomainSeparatedWireValue,
  identifier,
  safePositiveInteger,
  safeUnsignedInteger,
} from "../wire/index";
import { sha256DigestSchema, workspaceRevisionSchema } from "../workspace/sync-mutation";

export const RECOVERY_PROTOCOL_VERSION = 1 as const;
export const RECOVERY_BACKUP_SCHEMA_VERSION = 1 as const;

export const backupClassSchema = z.enum(["synchronized", "emergency"]);
export const cryptoProfileSchema = z.enum(["gd.backup.aead.v1"]);
export const backupIdSchema = identifier;
export const manifestDigestSchema = sha256DigestSchema;

// §5.1 SealedBackupEnvelope
//
// XChaCha20-Poly1305-class AEAD: 24-byte nonce (32 base64url chars),
// 16-byte auth tag (22 base64url chars).
export const sealedBackupEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(RECOVERY_BACKUP_SCHEMA_VERSION),
    cryptoProfile: cryptoProfileSchema,
    sealDomain: z.literal("gd.backup-seal.v1"),
    keyId: identifier,
    nonce: z.string().length(32).regex(/^[A-Za-z0-9_-]{32}$/),
    aad: manifestDigestSchema,
    ciphertext: base64Url,
    authTag: z.string().length(22).regex(/^[A-Za-z0-9_-]{22}$/),
  })
  .strict();

// §5.2 BackupExportDescriptor
export const backupExportDescriptorSchema = z
  .object({
    schemaVersion: z.literal(RECOVERY_BACKUP_SCHEMA_VERSION),
    backupClass: backupClassSchema,
    backupId: backupIdSchema,
    workspaceId: identifier,
    sourceDeviceId: identifier,
    activeLeaseEpoch: safePositiveInteger,
    throughRevision: workspaceRevisionSchema,
    proofId: identifier,
    proofDigest: sha256DigestSchema,
  })
  .strict();

// §5.3 EncryptedBackupManifest
const MANIFEST_DIGEST_DOMAIN = "GOODDEALER-RECOVERY-BACKUP-MANIFEST-V1";

const encryptedBackupManifestFields = {
  schemaVersion: z.literal(RECOVERY_BACKUP_SCHEMA_VERSION),
  backupClass: backupClassSchema,
  backupId: backupIdSchema,
  manifestDigest: manifestDigestSchema,
  workspaceId: identifier,
  workspaceSchemaVersion: safePositiveInteger,
  sourceDeviceId: identifier,
  activeLeaseEpoch: safePositiveInteger,
  throughRevision: workspaceRevisionSchema,
  cryptoProfile: cryptoProfileSchema,
  keyId: identifier,
  envelopeDigest: sha256DigestSchema,
  proofId: identifier,
  proofDigest: sha256DigestSchema,
} as const;

const encryptedBackupManifestBaseSchema = z.object(encryptedBackupManifestFields).strict();

// Injectable synchronous SHA-256 for manifest digest superRefine.
// When installed, the schema recomputes the manifest digest and rejects mismatches.
let computeSha256DigestSync: ((input: Uint8Array) => string) | null = null;

export const encryptedBackupManifestSchema = encryptedBackupManifestBaseSchema.superRefine(
  (manifest, context) => {
    if (computeSha256DigestSync === null) return;
    const { manifestDigest: _manifestDigest, ...digestInput } = manifest;
    const encoded = encodeDomainSeparatedWireValue(MANIFEST_DIGEST_DOMAIN, digestInput);
    const expected = computeSha256DigestSync(encoded);
    if (expected !== manifest.manifestDigest) {
      context.addIssue({
        code: "custom",
        path: ["manifestDigest"],
        message: "manifest digest does not match recomputed domain-separated digest",
      });
    }
  },
);

// §5.4 RestoreCandidate (Cloud-derived; Staging output only)
// NO apply_allowed variant in this slice.
export const restoreCandidateSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("rebase_required"),
      candidateId: identifier,
      backupId: backupIdSchema,
      workspaceId: identifier,
      compareRevision: workspaceRevisionSchema,
      manifestDigest: manifestDigestSchema,
      cloudDerivedAt: safeUnsignedInteger,
    })
    .strict(),
  z
    .object({
      status: z.literal("apply_blocked"),
      candidateId: identifier,
      backupId: backupIdSchema,
      workspaceId: identifier,
      compareRevision: workspaceRevisionSchema,
      manifestDigest: manifestDigestSchema,
      cloudDerivedAt: safeUnsignedInteger,
      currentValueHash: sha256DigestSchema,
      reason: z.enum(["baseline_ahead", "identity_mismatch", "proof_stale"]),
    })
    .strict(),
]);

/**
 * Encode the manifest digest input for external SHA-256 computation.
 * The caller must hash the returned bytes with SHA-256 and encode as unpadded base64url.
 */
export function encodeManifestDigestInput(manifest: unknown): Uint8Array {
  const parsed = encryptedBackupManifestBaseSchema.parse(manifest);
  const { manifestDigest: _manifestDigest, ...digestInput } = parsed;
  return encodeDomainSeparatedWireValue(MANIFEST_DIGEST_DOMAIN, digestInput);
}

/**
 * Install a synchronous SHA-256 digest function for manifest validation.
 * Must produce an unpadded base64url string from the input bytes.
 * In Node.js: installSha256DigestSync((input) => createHash("sha256").update(input).digest("base64url"))
 */
export function installSha256DigestSync(
  fn: (input: Uint8Array) => string,
): void {
  computeSha256DigestSync = fn;
}

export type BackupClass = z.infer<typeof backupClassSchema>;
export type CryptoProfile = z.infer<typeof cryptoProfileSchema>;
export type SealedBackupEnvelope = z.infer<typeof sealedBackupEnvelopeSchema>;
export type BackupExportDescriptor = z.infer<typeof backupExportDescriptorSchema>;
export type EncryptedBackupManifest = z.infer<typeof encryptedBackupManifestSchema>;
export type RestoreCandidate = z.infer<typeof restoreCandidateSchema>;
