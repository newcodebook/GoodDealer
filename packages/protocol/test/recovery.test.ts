import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { encodeDomainSeparatedWireValue } from "../src/wire/index";

import {
  backupExportDescriptorSchema,
  encryptedBackupManifestSchema,
  encodeManifestDigestInput,
  installSha256DigestSync,
  restoreCandidateSchema,
  sealedBackupEnvelopeSchema,
} from "../src/recovery/index";

// Install synchronous SHA-256 for manifest digest superRefine.
installSha256DigestSync((input) => createHash("sha256").update(input).digest("base64url"));

const vectors = resolve(import.meta.dirname, "../test-vectors/recovery");

function vector(path: string): unknown {
  return JSON.parse(readFileSync(resolve(vectors, path), "utf8"));
}

describe("recovery backup golden corpus", () => {
  // --- Valid vectors ---

  it("accepts valid/backup-export-descriptor.json", () => {
    expect(backupExportDescriptorSchema.safeParse(vector("valid/backup-export-descriptor.json")).success).toBe(true);
  });

  it("accepts valid/sealed-backup-envelope.json", () => {
    expect(sealedBackupEnvelopeSchema.safeParse(vector("valid/sealed-backup-envelope.json")).success).toBe(true);
  });

  it("accepts valid/encrypted-backup-manifest.json", () => {
    expect(encryptedBackupManifestSchema.safeParse(vector("valid/encrypted-backup-manifest.json")).success).toBe(true);
  });

  it("accepts valid/restore-candidate-rebase.json", () => {
    expect(restoreCandidateSchema.safeParse(vector("valid/restore-candidate-rebase.json")).success).toBe(true);
  });

  it("accepts valid/restore-candidate-blocked.json", () => {
    expect(restoreCandidateSchema.safeParse(vector("valid/restore-candidate-blocked.json")).success).toBe(true);
  });

  // --- §NEG: Unknown/extra field on any object => .strict() rejects ---

  for (const path of [
    "invalid/descriptor-unknown-field.json",
    "invalid/envelope-unknown-field.json",
    "invalid/manifest-unknown-field.json",
    "invalid/candidate-unknown-field.json",
  ] as const) {
    it(`rejects ${path} (unknown field)`, () => {
      const schema = path.includes("descriptor")
        ? backupExportDescriptorSchema
        : path.includes("envelope")
          ? sealedBackupEnvelopeSchema
          : path.includes("manifest")
            ? encryptedBackupManifestSchema
            : restoreCandidateSchema;
      expect(schema.safeParse(vector(path)).success).toBe(false);
    });
  }

  // --- §NEG: Missing required field => zod required ---

  for (const path of [
    "invalid/descriptor-missing-field.json",
    "invalid/manifest-missing-field.json",
    "invalid/candidate-missing-field.json",
  ] as const) {
    it(`rejects ${path} (missing field)`, () => {
      const schema = path.includes("descriptor")
        ? backupExportDescriptorSchema
        : path.includes("manifest")
          ? encryptedBackupManifestSchema
          : restoreCandidateSchema;
      expect(schema.safeParse(vector(path)).success).toBe(false);
    });
  }

  // --- §NEG: Unknown backupClass / cryptoProfile / status / reason ---

  it("rejects invalid/descriptor-unknown-backup-class.json", () => {
    expect(backupExportDescriptorSchema.safeParse(vector("invalid/descriptor-unknown-backup-class.json")).success).toBe(false);
  });

  it("rejects invalid/envelope-unknown-crypto-profile.json", () => {
    expect(sealedBackupEnvelopeSchema.safeParse(vector("invalid/envelope-unknown-crypto-profile.json")).success).toBe(false);
  });

  it("rejects invalid/candidate-unknown-status.json (apply_allowed is not in union)", () => {
    expect(restoreCandidateSchema.safeParse(vector("invalid/candidate-unknown-status.json")).success).toBe(false);
  });

  it("rejects invalid/candidate-unknown-reason.json", () => {
    expect(restoreCandidateSchema.safeParse(vector("invalid/candidate-unknown-reason.json")).success).toBe(false);
  });

  // --- §NEG: manifestDigest != recomputed digest => manifest superRefine ---

  it("rejects invalid/manifest-tampered-digest.json (T1 tamper)", () => {
    expect(encryptedBackupManifestSchema.safeParse(vector("invalid/manifest-tampered-digest.json")).success).toBe(false);
  });

  // --- Emergency backupClass is accepted ---

  it("accepts emergency backupClass in descriptor", () => {
    const base = vector("valid/backup-export-descriptor.json") as Record<string, unknown>;
    expect(backupExportDescriptorSchema.safeParse({ ...base, backupClass: "emergency" }).success).toBe(true);
  });

  // --- apply_blocked reasons are closed ---

  for (const validReason of ["baseline_ahead", "identity_mismatch", "proof_stale"] as const) {
    it(`accepts apply_blocked reason '${validReason}'`, () => {
      const base = vector("valid/restore-candidate-blocked.json") as Record<string, unknown>;
      expect(restoreCandidateSchema.safeParse({ ...base, reason: validReason }).success).toBe(true);
    });
  }

  // --- Manifest digest transcript is deterministic ---

  it("freezes the manifest digest transcript", () => {
    const manifest = vector("valid/encrypted-backup-manifest.json");
    const digest = createHash("sha256")
      .update(encodeManifestDigestInput(manifest))
      .digest("base64url");
    expect(digest).toBe("k14SrYjax6vC8tvPWAhAnsaTZGykiIeTms6uJxqK-dE");
  });

  it("uses the correct domain for manifest digest encoding", () => {
    const manifest = vector("valid/encrypted-backup-manifest.json") as Record<string, unknown>;
    const { manifestDigest: _, ...digestInput } = manifest;
    const encoded = encodeManifestDigestInput(manifest);
    const expected = encodeDomainSeparatedWireValue(
      "GOODDEALER-RECOVERY-BACKUP-MANIFEST-V1",
      digestInput,
    );
    expect(Buffer.from(encoded).equals(Buffer.from(expected))).toBe(true);
  });
});
