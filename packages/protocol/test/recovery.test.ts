import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  backupExportSchema,
  backupExportPageSchema,
  backupManifestSchema,
  encodeBackupExportPageDigestInput,
  encodeBackupManifestDigestInput,
  encodeRestoreDiffDigestInput,
  manifestDigestSchema,
  manifestBoundDiffRequestSchema,
  manifestBoundDiffPageSchema,
  restoreCandidatePageSchema,
  restoreCandidateLifecycleCommandSchema,
  restoreCandidateReceiptSchema,
  restoreCandidateSchema,
} from "../src/recovery/index";

const recoveryCorpusSchema = z.object({
  schemaVersion: z.literal(1),
  manifestDigest: z.object({ fields: z.record(z.string(), z.unknown()), expected: manifestDigestSchema }).strict(),
  diffDigest: z.object({ entries: z.array(z.unknown()), expected: manifestDigestSchema }).strict(),
  validBackupExports: z.array(z.unknown()),
  invalidBackupExports: z.array(z.unknown()),
  validLifecycleCommands: z.array(z.unknown()),
  invalidLifecycleCommands: z.array(z.unknown()),
}).strict();
const recoveryCorpus = recoveryCorpusSchema.parse(JSON.parse(readFileSync(
  new URL("../test-vectors/recovery/wire-corpus.json", import.meta.url),
  "utf8",
)));

const digest = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const entry = (fieldPath: "note" | "portfolioId" | "tags" | "targetPrice", backupValue: unknown) => ({
  entityId: "a.test",
  fieldPath,
  backupValue,
  backupValueHash: digest,
});

const manifestFields = {
  schemaVersion: 1,
  backupClass: "synchronized",
  backupId: "backup-a",
  workspaceId: "workspace-a",
  workspaceSchemaVersion: 1,
  appVersion: "0.0.0",
  createdAt: "2026-08-20T10:00:00Z",
  sourceDeviceId: "device-a",
  activeLeaseEpoch: 7,
  throughServerRevision: 12,
  localCommitSequence: 22,
  cryptoProfile: "xchacha20-poly1305-stream-v1",
  proofId: "proof-a",
  proofDigest: digest,
  sections: [{ kind: "domain_asset", plaintextLength: 32, sha256: digest }],
} as const;

const candidate = {
  schemaVersion: 1,
  candidateId: "candidate-a",
  candidateRequestId: "request-a",
  recoveryWorkflowId: "workflow-a",
  backupId: "backup-a",
  manifestDigest: digest,
  comparisonServerRevision: 12,
  ...entry("note", "backup note"),
  currentValueHash: digest,
  status: "open",
  rowVersion: 1,
  createdAt: "2026-08-20T10:00:00Z",
  updatedAt: "2026-08-20T10:00:00Z",
  expiresAt: "2026-08-21T10:00:00Z",
} as const;

describe("recovery foundation protocol", () => {
  it("accepts only the canonical four-field backup export", () => {
    expect(backupExportSchema.parse({
      schemaVersion: 1,
      records: [{
        entityId: "a.test",
        note: "backup note",
        portfolioId: null,
        tags: ["tag-a"],
        targetPrice: { currency: "USD", amount: "12.5" },
      }],
    }).records).toHaveLength(1);
    expect(backupExportSchema.safeParse({ schemaVersion: 1, records: [{ entityId: "a.test", credentialRef: "secret" }] }).success).toBe(false);
    expect(backupExportSchema.safeParse({ schemaVersion: 1, records: [
      { entityId: "b.test", note: null, portfolioId: null, tags: [], targetPrice: null },
      { entityId: "a.test", note: null, portfolioId: null, tags: [], targetPrice: null },
    ] }).success).toBe(false);
  });

  it("freezes the manifest and diff digest transcripts", () => {
    const manifestInput = encodeBackupManifestDigestInput(manifestFields);
    const entries = [entry("note", "backup note"), entry("portfolioId", null), entry("tags", ["tag-a"]), entry("targetPrice", null)];
    const diffInput = encodeRestoreDiffDigestInput(entries);
    expect(createHash("sha256").update(manifestInput).digest("base64url")).toHaveLength(43);
    expect(createHash("sha256").update(diffInput).digest("base64url")).toHaveLength(43);
    expect(backupManifestSchema.safeParse({ ...manifestFields, manifestDigest: digest }).success).toBe(true);
    expect(manifestBoundDiffRequestSchema.safeParse({
      schemaVersion: 1,
      recoveryWorkflowId: "workflow-a",
      backupId: "backup-a",
      manifestDigest: digest,
      diffDigest: digest,
      entries,
    }).success).toBe(true);
    expect(manifestBoundDiffRequestSchema.safeParse({
      schemaVersion: 1,
      recoveryWorkflowId: "workflow-a",
      backupId: "backup-a",
      manifestDigest: digest,
      diffDigest: digest,
      entries: [entries[1], entries[0]],
    }).success).toBe(false);
  });

  it("represents million-asset recovery as bounded canonical pages and manifest sections", () => {
    const record = {
      entityId: "a.test",
      note: null,
      portfolioId: null,
      tags: [],
      targetPrice: null,
    } as const;
    const backupPage = {
      schemaVersion: 1,
      sectionId: "section-a",
      pageOrdinal: 0,
      rangeStart: "a.test",
      rangeEnd: "a.test",
      entryCount: 1,
      encodedBytes: 128,
      nextCursor: "cursor-b",
      records: [record],
      pageDigest: digest,
    } as const;
    expect(backupExportPageSchema.safeParse(backupPage).success).toBe(true);
    expect(createHash("sha256").update(encodeBackupExportPageDigestInput(backupPage)).digest("base64url"))
      .toHaveLength(43);
    expect(backupManifestSchema.safeParse({
      ...manifestFields,
      sections: [
        { kind: "domain_asset", sectionId: "section-a", rangeStart: "a.test", rangeEnd: "m.test", entryCount: 500_000, plaintextLength: 1024, sha256: digest },
        { kind: "domain_asset", sectionId: "section-b", rangeStart: "n.test", rangeEnd: "z.test", entryCount: 500_000, plaintextLength: 1024, sha256: digest },
      ],
      manifestDigest: digest,
    }).success).toBe(true);
    expect(manifestBoundDiffPageSchema.safeParse({
      schemaVersion: 1,
      recoveryWorkflowId: "workflow-a",
      backupId: "backup-a",
      manifestDigest: digest,
      pageId: "diff-page-a",
      pageOrdinal: 0,
      rangeStart: "a.test",
      rangeEnd: "a.test",
      entryCount: 1,
      encodedBytes: 256,
      nextCursor: null,
      entries: [entry("note", "backup note")],
      pageDigest: digest,
    }).success).toBe(true);
    expect(restoreCandidatePageSchema.safeParse({
      schemaVersion: 1,
      candidateRequestId: "request-a",
      recoveryWorkflowId: "workflow-a",
      backupId: "backup-a",
      manifestDigest: digest,
      comparisonServerRevision: 12,
      pageId: "candidate-page-a",
      pageOrdinal: 0,
      entryCount: 1,
      encodedBytes: 512,
      nextCursor: null,
      candidates: [candidate],
      pageDigest: digest,
    }).success).toBe(true);
  });

  it("matches Rust on the shared current recovery corpus", () => {
    expect(createHash("sha256")
      .update(encodeBackupManifestDigestInput(recoveryCorpus.manifestDigest.fields))
      .digest("base64url")).toBe(recoveryCorpus.manifestDigest.expected);
    expect(createHash("sha256")
      .update(encodeRestoreDiffDigestInput(recoveryCorpus.diffDigest.entries))
      .digest("base64url")).toBe(recoveryCorpus.diffDigest.expected);
    for (const value of recoveryCorpus.validBackupExports) expect(backupExportSchema.safeParse(value).success).toBe(true);
    for (const value of recoveryCorpus.invalidBackupExports) expect(backupExportSchema.safeParse(value).success).toBe(false);
    for (const value of recoveryCorpus.validLifecycleCommands) expect(restoreCandidateLifecycleCommandSchema.safeParse(value).success).toBe(true);
    for (const value of recoveryCorpus.invalidLifecycleCommands) expect(restoreCandidateLifecycleCommandSchema.safeParse(value).success).toBe(false);
  });

  it("binds candidate value type to its field path and parses historical applied read state", () => {
    expect(restoreCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(restoreCandidateSchema.safeParse({ ...candidate, backupValue: ["wrong-kind"] }).success).toBe(false);
    expect(restoreCandidateSchema.safeParse({ ...candidate, status: "applied" }).success).toBe(true);
    expect(restoreCandidateSchema.safeParse({ ...candidate, rawKey: "forbidden" }).success).toBe(false);
  });

  it("allows no Apply lifecycle command", () => {
    for (const transition of ["rebase_required", "discarded", "expired"] as const) {
      expect(restoreCandidateLifecycleCommandSchema.safeParse({ schemaVersion: 1, candidateId: "candidate-a", expectedRowVersion: 1, transition }).success).toBe(true);
    }
    expect(restoreCandidateLifecycleCommandSchema.safeParse({ schemaVersion: 1, candidateId: "candidate-a", expectedRowVersion: 1, transition: "applied" }).success).toBe(false);
  });

  it("keeps receipt identity and candidates strict", () => {
    expect(restoreCandidateReceiptSchema.safeParse({
      schemaVersion: 1,
      candidateRequestId: "request-a",
      recoveryWorkflowId: "workflow-a",
      backupId: "backup-a",
      manifestDigest: digest,
      comparisonServerRevision: 12,
      requestDigest: digest,
      receiptDigest: digest,
      createdAt: "2026-08-20T10:00:00Z",
      candidates: [candidate],
    }).success).toBe(true);
  });
});
