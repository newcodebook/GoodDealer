import { z } from "zod";

import { canonicalUtcTimestamp, encodeDomainSeparatedWireValue, identifier, safePositiveInteger, safeUnsignedInteger } from "../wire/index";
import { canonicalMoneySchema, compareUtf8, domainAssetIdSchema, domainAssetNoteSchema, domainAssetTagsSchema } from "../workspace/domain-asset-fields";
import { sha256DigestSchema, serverRevisionSchema } from "../workspace/sync-mutation";

export const RECOVERY_PROTOCOL_VERSION = 1 as const;
export const RECOVERY_BACKUP_SCHEMA_VERSION = 1 as const;
export const RECOVERY_MANIFEST_DIGEST_DOMAIN = "GOODDEALER-BACKUP-MANIFEST-V1" as const;
export const RECOVERY_DIFF_DIGEST_DOMAIN = "GOODDEALER-RESTORE-DIFF-V1" as const;
export const RECOVERY_BACKUP_PAGE_DIGEST_DOMAIN = "GOODDEALER-BACKUP-PAGE-V1" as const;
export const RECOVERY_DIFF_PAGE_DIGEST_DOMAIN = "GOODDEALER-RESTORE-DIFF-PAGE-V1" as const;
export const RECOVERY_CANDIDATE_PAGE_DIGEST_DOMAIN = "GOODDEALER-RESTORE-CANDIDATE-PAGE-V1" as const;
export const RECOVERY_PAGE_MAX_ENTRIES = 1_024 as const;
export const RECOVERY_PAGE_MAX_ENCODED_BYTES = 4 * 1024 * 1024;
export const RECOVERY_MANIFEST_MAX_SECTIONS = 256 as const;

export const backupIdSchema = identifier;
export const manifestDigestSchema = sha256DigestSchema;
export const backupFieldPathSchema = z.enum(["note", "portfolioId", "tags", "targetPrice"]);

export const backupRecordSchema = z.object({
  entityId: domainAssetIdSchema,
  note: domainAssetNoteSchema.nullable(),
  portfolioId: identifier.nullable(),
  tags: domainAssetTagsSchema,
  targetPrice: canonicalMoneySchema.nullable(),
}).strict();

export const backupExportSchema = z.object({
  schemaVersion: z.literal(RECOVERY_BACKUP_SCHEMA_VERSION),
  records: z.array(backupRecordSchema).max(10_000),
}).strict().superRefine(({ records }, context) => {
  for (let index = 1; index < records.length; index += 1) {
    if (compareUtf8(records[index - 1]!.entityId, records[index]!.entityId) >= 0) {
      context.addIssue({ code: "custom", path: ["records", index], message: "records must be unique and ascending" });
      break;
    }
  }
});

const backupExportPageFieldsSchema = z.object({
  schemaVersion: z.literal(RECOVERY_BACKUP_SCHEMA_VERSION),
  sectionId: identifier,
  pageOrdinal: safeUnsignedInteger.max(999_999),
  rangeStart: domainAssetIdSchema.nullable(),
  rangeEnd: domainAssetIdSchema.nullable(),
  entryCount: safeUnsignedInteger.max(RECOVERY_PAGE_MAX_ENTRIES),
  encodedBytes: safeUnsignedInteger.max(RECOVERY_PAGE_MAX_ENCODED_BYTES),
  nextCursor: identifier.nullable(),
  records: z.array(backupRecordSchema).max(RECOVERY_PAGE_MAX_ENTRIES),
}).strict().superRefine((page, context) => {
  if (page.entryCount !== page.records.length) {
    context.addIssue({ code: "custom", path: ["entryCount"], message: "entry count must match records" });
  }
  for (let index = 1; index < page.records.length; index += 1) {
    if (compareUtf8(page.records[index - 1]!.entityId, page.records[index]!.entityId) >= 0) {
      context.addIssue({ code: "custom", path: ["records", index], message: "records must be unique and ascending" });
      break;
    }
  }
  const first = page.records[0]?.entityId ?? null;
  const last = page.records.at(-1)?.entityId ?? null;
  if (page.rangeStart !== first || page.rangeEnd !== last) {
    context.addIssue({ code: "custom", path: ["rangeStart"], message: "page range must bind its records" });
  }
});

export const backupExportPageSchema = backupExportPageFieldsSchema.safeExtend({
  pageDigest: sha256DigestSchema,
}).strict();

export function encodeBackupExportPageDigestInput(value: unknown): Uint8Array {
  const parsed = backupExportPageSchema.parse(value);
  const { pageDigest: _pageDigest, ...fields } = parsed;
  return encodeDomainSeparatedWireValue(RECOVERY_BACKUP_PAGE_DIGEST_DOMAIN, fields);
}

export const backupManifestSectionSchema = z.object({
  kind: z.literal("domain_asset"),
  sectionId: identifier.optional(),
  rangeStart: domainAssetIdSchema.nullable().optional(),
  rangeEnd: domainAssetIdSchema.nullable().optional(),
  entryCount: safeUnsignedInteger.max(1_000_000).optional(),
  plaintextLength: safeUnsignedInteger.max(16 * 1024 * 1024),
  sha256: sha256DigestSchema,
}).strict();

const backupManifestFieldsSchema = z.object({
  schemaVersion: z.literal(RECOVERY_BACKUP_SCHEMA_VERSION),
  backupClass: z.literal("synchronized"),
  backupId: backupIdSchema,
  workspaceId: identifier,
  workspaceSchemaVersion: safePositiveInteger,
  appVersion: z.string().min(1).max(64),
  createdAt: canonicalUtcTimestamp,
  sourceDeviceId: identifier,
  activeLeaseEpoch: safePositiveInteger,
  throughServerRevision: serverRevisionSchema,
  localCommitSequence: safePositiveInteger,
  cryptoProfile: z.literal("xchacha20-poly1305-stream-v1"),
  proofId: identifier,
  proofDigest: sha256DigestSchema,
  sections: z.array(backupManifestSectionSchema).min(1).max(RECOVERY_MANIFEST_MAX_SECTIONS),
}).strict().superRefine(({ sections }, context) => {
  if (sections.length === 1 && sections[0]?.sectionId === undefined) return;
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index]!;
    if (section.sectionId === undefined || section.rangeStart === undefined ||
      section.rangeEnd === undefined || section.entryCount === undefined) {
      context.addIssue({ code: "custom", path: ["sections", index], message: "partitioned sections require range metadata" });
      continue;
    }
    if (section.rangeStart === null || section.rangeEnd === null ||
      compareUtf8(section.rangeStart, section.rangeEnd) > 0) {
      context.addIssue({ code: "custom", path: ["sections", index], message: "section range is invalid" });
    }
    const previous = sections[index - 1];
    if (previous?.rangeEnd !== undefined && previous.rangeEnd !== null && section.rangeStart !== null &&
      compareUtf8(previous.rangeEnd, section.rangeStart) >= 0) {
      context.addIssue({ code: "custom", path: ["sections", index], message: "section ranges must be disjoint and ascending" });
    }
  }
});

export const backupManifestSchema = backupManifestFieldsSchema.extend({ manifestDigest: manifestDigestSchema }).strict();

export function encodeBackupManifestDigestInput(value: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(RECOVERY_MANIFEST_DIGEST_DOMAIN, backupManifestFieldsSchema.parse(value));
}

const noteDiffEntrySchema = z.object({ entityId: domainAssetIdSchema, fieldPath: z.literal("note"), backupValue: domainAssetNoteSchema.nullable(), backupValueHash: sha256DigestSchema }).strict();
const portfolioDiffEntrySchema = z.object({ entityId: domainAssetIdSchema, fieldPath: z.literal("portfolioId"), backupValue: identifier.nullable(), backupValueHash: sha256DigestSchema }).strict();
const tagsDiffEntrySchema = z.object({ entityId: domainAssetIdSchema, fieldPath: z.literal("tags"), backupValue: domainAssetTagsSchema, backupValueHash: sha256DigestSchema }).strict();
const targetPriceDiffEntrySchema = z.object({ entityId: domainAssetIdSchema, fieldPath: z.literal("targetPrice"), backupValue: canonicalMoneySchema.nullable(), backupValueHash: sha256DigestSchema }).strict();

export const backupDiffEntrySchema = z.discriminatedUnion("fieldPath", [noteDiffEntrySchema, portfolioDiffEntrySchema, tagsDiffEntrySchema, targetPriceDiffEntrySchema]);
const fieldOrder = new Map<z.infer<typeof backupFieldPathSchema>, number>([["note", 0], ["portfolioId", 1], ["tags", 2], ["targetPrice", 3]]);

export const manifestBoundDiffRequestSchema = z.object({
  schemaVersion: z.literal(RECOVERY_PROTOCOL_VERSION),
  recoveryWorkflowId: identifier,
  backupId: backupIdSchema,
  manifestDigest: manifestDigestSchema,
  diffDigest: sha256DigestSchema,
  entries: z.array(backupDiffEntrySchema).max(40_000),
}).strict().superRefine(({ entries }, context) => {
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1]!;
    const current = entries[index]!;
    const entityOrder = compareUtf8(previous.entityId, current.entityId);
    if (entityOrder > 0 || (entityOrder === 0 && fieldOrder.get(previous.fieldPath)! >= fieldOrder.get(current.fieldPath)!)) {
      context.addIssue({ code: "custom", path: ["entries", index], message: "diff entries must be unique and canonical" });
      break;
    }
  }
});

export function encodeRestoreDiffDigestInput(entries: unknown): Uint8Array {
  return encodeDomainSeparatedWireValue(RECOVERY_DIFF_DIGEST_DOMAIN, z.array(backupDiffEntrySchema).max(40_000).parse(entries));
}

const manifestBoundDiffPageFieldsSchema = z.object({
  schemaVersion: z.literal(RECOVERY_PROTOCOL_VERSION),
  recoveryWorkflowId: identifier,
  backupId: backupIdSchema,
  manifestDigest: manifestDigestSchema,
  pageId: identifier,
  pageOrdinal: safeUnsignedInteger.max(3_999_999),
  rangeStart: domainAssetIdSchema.nullable(),
  rangeEnd: domainAssetIdSchema.nullable(),
  entryCount: safeUnsignedInteger.max(RECOVERY_PAGE_MAX_ENTRIES),
  encodedBytes: safeUnsignedInteger.max(RECOVERY_PAGE_MAX_ENCODED_BYTES),
  nextCursor: identifier.nullable(),
  entries: z.array(backupDiffEntrySchema).max(RECOVERY_PAGE_MAX_ENTRIES),
}).strict().superRefine((page, context) => {
  if (page.entryCount !== page.entries.length) {
    context.addIssue({ code: "custom", path: ["entryCount"], message: "entry count must match diff entries" });
  }
  for (let index = 1; index < page.entries.length; index += 1) {
    const previous = page.entries[index - 1]!;
    const current = page.entries[index]!;
    const entityOrder = compareUtf8(previous.entityId, current.entityId);
    if (entityOrder > 0 || (entityOrder === 0 && fieldOrder.get(previous.fieldPath)! >= fieldOrder.get(current.fieldPath)!)) {
      context.addIssue({ code: "custom", path: ["entries", index], message: "diff entries must be unique and canonical" });
      break;
    }
  }
  const first = page.entries[0]?.entityId ?? null;
  const last = page.entries.at(-1)?.entityId ?? null;
  if (page.rangeStart !== first || page.rangeEnd !== last) {
    context.addIssue({ code: "custom", path: ["rangeStart"], message: "page range must bind its diff entries" });
  }
});

export const manifestBoundDiffPageSchema = manifestBoundDiffPageFieldsSchema.safeExtend({
  pageDigest: sha256DigestSchema,
}).strict();

export function encodeRestoreDiffPageDigestInput(value: unknown): Uint8Array {
  const parsed = manifestBoundDiffPageSchema.parse(value);
  const { pageDigest: _pageDigest, ...fields } = parsed;
  return encodeDomainSeparatedWireValue(RECOVERY_DIFF_PAGE_DIGEST_DOMAIN, fields);
}

export const restoreCandidateStatusSchema = z.enum(["open", "rebase_required", "discarded", "expired", "applied"]);
export const restoreCandidateSchema = z.object({
  schemaVersion: z.literal(RECOVERY_PROTOCOL_VERSION),
  candidateId: identifier,
  candidateRequestId: identifier,
  recoveryWorkflowId: identifier,
  backupId: backupIdSchema,
  manifestDigest: manifestDigestSchema,
  comparisonServerRevision: serverRevisionSchema,
  entityId: domainAssetIdSchema,
  fieldPath: backupFieldPathSchema,
  backupValue: z.unknown(),
  backupValueHash: sha256DigestSchema,
  currentValueHash: sha256DigestSchema,
  status: restoreCandidateStatusSchema,
  rowVersion: safePositiveInteger,
  createdAt: canonicalUtcTimestamp,
  updatedAt: canonicalUtcTimestamp,
  expiresAt: canonicalUtcTimestamp,
}).strict().superRefine((candidate, context) => {
  if (!backupDiffEntrySchema.safeParse({
    entityId: candidate.entityId,
    fieldPath: candidate.fieldPath,
    backupValue: candidate.backupValue,
    backupValueHash: candidate.backupValueHash,
  }).success) {
    context.addIssue({ code: "custom", path: ["backupValue"], message: "backup value does not match field path" });
  }
});

export const restoreCandidateReceiptSchema = z.object({
  schemaVersion: z.literal(RECOVERY_PROTOCOL_VERSION),
  candidateRequestId: identifier,
  recoveryWorkflowId: identifier,
  backupId: backupIdSchema,
  manifestDigest: manifestDigestSchema,
  comparisonServerRevision: serverRevisionSchema,
  requestDigest: sha256DigestSchema,
  receiptDigest: sha256DigestSchema,
  createdAt: canonicalUtcTimestamp,
  candidates: z.array(restoreCandidateSchema).max(40_000),
}).strict();

const restoreCandidatePageFieldsSchema = z.object({
  schemaVersion: z.literal(RECOVERY_PROTOCOL_VERSION),
  candidateRequestId: identifier,
  recoveryWorkflowId: identifier,
  backupId: backupIdSchema,
  manifestDigest: manifestDigestSchema,
  comparisonServerRevision: serverRevisionSchema,
  pageId: identifier,
  pageOrdinal: safeUnsignedInteger.max(3_999_999),
  entryCount: safeUnsignedInteger.max(RECOVERY_PAGE_MAX_ENTRIES),
  encodedBytes: safeUnsignedInteger.max(RECOVERY_PAGE_MAX_ENCODED_BYTES),
  nextCursor: identifier.nullable(),
  candidates: z.array(restoreCandidateSchema).max(RECOVERY_PAGE_MAX_ENTRIES),
}).strict().superRefine((page, context) => {
  if (page.entryCount !== page.candidates.length) {
    context.addIssue({ code: "custom", path: ["entryCount"], message: "entry count must match candidates" });
  }
});

export const restoreCandidatePageSchema = restoreCandidatePageFieldsSchema.safeExtend({
  pageDigest: sha256DigestSchema,
}).strict();

export function encodeRestoreCandidatePageDigestInput(value: unknown): Uint8Array {
  const parsed = restoreCandidatePageSchema.parse(value);
  const { pageDigest: _pageDigest, ...fields } = parsed;
  return encodeDomainSeparatedWireValue(RECOVERY_CANDIDATE_PAGE_DIGEST_DOMAIN, fields);
}

export const restoreCandidateLifecycleCommandSchema = z.object({
  schemaVersion: z.literal(RECOVERY_PROTOCOL_VERSION),
  candidateId: identifier,
  expectedRowVersion: safePositiveInteger,
  transition: z.enum(["rebase_required", "discarded", "expired"]),
}).strict();

export type BackupRecord = z.infer<typeof backupRecordSchema>;
export type BackupExport = z.infer<typeof backupExportSchema>;
export type BackupExportPage = z.infer<typeof backupExportPageSchema>;
export type BackupManifest = z.infer<typeof backupManifestSchema>;
export type BackupFieldPath = z.infer<typeof backupFieldPathSchema>;
export type BackupDiffEntry = z.infer<typeof backupDiffEntrySchema>;
export type ManifestBoundDiffRequest = z.infer<typeof manifestBoundDiffRequestSchema>;
export type ManifestBoundDiffPage = z.infer<typeof manifestBoundDiffPageSchema>;
export type RestoreCandidate = z.infer<typeof restoreCandidateSchema>;
export type RestoreCandidateReceipt = z.infer<typeof restoreCandidateReceiptSchema>;
export type RestoreCandidatePage = z.infer<typeof restoreCandidatePageSchema>;
export type RestoreCandidateLifecycleCommand = z.infer<typeof restoreCandidateLifecycleCommandSchema>;
