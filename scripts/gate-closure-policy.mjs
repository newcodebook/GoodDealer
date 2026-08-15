import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";

const schema = JSON.parse(readFileSync(new URL("./schemas/r0-11-gate-closure-attestation.schema.json", import.meta.url), "utf8"));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

export const R0_11_REQUIRED_EVIDENCE_SETS = Object.freeze([
  Object.freeze({ profile: "quality", platform: "linux", architecture: "x64", job_name: "quality" }),
  Object.freeze({ profile: "native", platform: "win32", architecture: "x64", job_name: "windows-server-2025-x64-compile" }),
  Object.freeze({ profile: "native", platform: "darwin", architecture: "arm64", job_name: "macos-15-arm64" }),
  Object.freeze({ profile: "native", platform: "darwin", architecture: "x64", job_name: "macos-15-intel" }),
  Object.freeze({ profile: "real-device", platform: "win32", architecture: "x64", job_name: "windows-11-24h2-real-install" }),
]);

const REQUIRED_OWNER_ROLE = "Release Engineering Lead";
const REQUIRED_REVIEW_ROLES = Object.freeze(["Architecture Reviewer"]);
const REQUIRED_APPROVER_ROLE = "Phase 0 Gate Approver";
const PLACEHOLDER_PATTERN = /(?:replace|placeholder|todo|example\.invalid)/iu;

function evidenceSetKey(value) {
  return [value.profile, value.platform, value.architecture, value.job_name].join("/");
}

function sorted(values) {
  return [...values].sort();
}

function timestamp(value) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function gateClosureAttestationErrors(value, { now = new Date() } = {}) {
  if (!validateSchema(value)) {
    return (validateSchema.errors ?? []).map(({ instancePath, message }) => `schema${instancePath || "/"}: ${message}`);
  }

  const errors = [];
  const implementationRefs = new Set(value.implementation_refs);
  const actualEvidenceKeys = value.evidence_sets.map(evidenceSetKey);
  const requiredEvidenceKeys = R0_11_REQUIRED_EVIDENCE_SETS.map(evidenceSetKey);
  const duplicateEvidenceKeys = actualEvidenceKeys.filter((key, index) => actualEvidenceKeys.indexOf(key) !== index);
  if (duplicateEvidenceKeys.length > 0) errors.push(`duplicate evidence sets: ${sorted(new Set(duplicateEvidenceKeys)).join(", ")}`);
  const missingEvidenceKeys = requiredEvidenceKeys.filter((key) => !actualEvidenceKeys.includes(key));
  const unexpectedEvidenceKeys = actualEvidenceKeys.filter((key) => !requiredEvidenceKeys.includes(key));
  if (missingEvidenceKeys.length > 0) errors.push(`missing R0-11 evidence sets: ${missingEvidenceKeys.join(", ")}`);
  if (unexpectedEvidenceKeys.length > 0) errors.push(`unexpected R0-11 evidence sets: ${unexpectedEvidenceKeys.join(", ")}`);

  if (value.owner.role !== REQUIRED_OWNER_ROLE) errors.push(`owner role must be ${REQUIRED_OWNER_ROLE}`);
  if (!implementationRefs.has(value.owner.ref)) errors.push("owner ref must be included in implementation_refs");
  if (implementationRefs.has(value.approval.ref)) errors.push("an implementer cannot approve R0-11");
  if (value.approval.role !== REQUIRED_APPROVER_ROLE) errors.push(`approval role must be ${REQUIRED_APPROVER_ROLE}`);

  const reviewRoles = new Set(value.reviews.map(({ role }) => role));
  const missingReviewRoles = REQUIRED_REVIEW_ROLES.filter((role) => !reviewRoles.has(role));
  if (missingReviewRoles.length > 0) errors.push(`missing required review roles: ${missingReviewRoles.join(", ")}`);
  const requiredReviewRefs = value.reviews.filter(({ role }) => REQUIRED_REVIEW_ROLES.includes(role)).map(({ ref }) => ref);
  if (new Set(requiredReviewRefs).size !== requiredReviewRefs.length) errors.push("one identity cannot satisfy multiple required reviewer roles");

  const expectedImplementationRefs = sorted(implementationRefs);
  for (const review of value.reviews) {
    if (implementationRefs.has(review.ref)) errors.push(`reviewer ${review.ref} is listed as an implementer`);
    const assertedRefs = sorted(review.independence_assertion.implementation_refs);
    if (JSON.stringify(assertedRefs) !== JSON.stringify(expectedImplementationRefs)) {
      errors.push(`reviewer ${review.ref} did not assert against the complete implementation_refs set`);
    }
  }

  const approvalTime = timestamp(value.approval.approved_at);
  for (const review of value.reviews) {
    const reviewTime = timestamp(review.reviewed_at);
    if (reviewTime === null || approvalTime === null || reviewTime > approvalTime) {
      errors.push(`review by ${review.ref} must be timestamped no later than approval`);
    }
  }

  const archiveRefs = new Set();
  const artifactIds = new Set();
  for (const evidenceSet of value.evidence_sets) {
    const { artifact, archive } = evidenceSet;
    if (!artifact.job_url.startsWith(`${artifact.run_url}/job/`)) {
      errors.push(`${evidenceSetKey(evidenceSet)} job_url does not belong to run_url`);
    }
    if (artifactIds.has(artifact.artifact_id)) errors.push(`artifact_id ${artifact.artifact_id} is reused across evidence sets`);
    artifactIds.add(artifact.artifact_id);
    if (archiveRefs.has(archive.archive_ref)) errors.push(`archive_ref ${archive.archive_ref} is reused across evidence sets`);
    archiveRefs.add(archive.archive_ref);
    if (PLACEHOLDER_PATTERN.test(archive.archive_ref) || PLACEHOLDER_PATTERN.test(archive.retention_policy.policy_ref)) {
      errors.push(`${evidenceSetKey(evidenceSet)} contains a placeholder archive reference`);
    }
    if (/github\.com\/newcodebook\/GoodDealer\/actions\//u.test(archive.archive_ref)) {
      errors.push(`${evidenceSetKey(evidenceSet)} uses a transient GitHub Actions URL as its archive`);
    }
    if (archive.archive_sha256 !== artifact.artifact_digest) {
      errors.push(`${evidenceSetKey(evidenceSet)} archive digest does not match the transferred artifact`);
    }
    if (implementationRefs.has(archive.verified_by_ref)) {
      errors.push(`${evidenceSetKey(evidenceSet)} archive was verified only by an implementer`);
    }
    const verifiedAt = timestamp(archive.verified_at);
    const retainUntil = timestamp(archive.retention_policy.retain_until);
    if (verifiedAt === null || approvalTime === null || verifiedAt > approvalTime) {
      errors.push(`${evidenceSetKey(evidenceSet)} archive verification must precede approval`);
    }
    if (retainUntil === null || retainUntil <= now.getTime() || (approvalTime !== null && retainUntil <= approvalTime)) {
      errors.push(`${evidenceSetKey(evidenceSet)} archive retention must extend beyond validation and approval`);
    }
  }
  return errors;
}

export function validateGateClosureAttestation(value, options) {
  const errors = gateClosureAttestationErrors(value, options);
  return { valid: errors.length === 0, errors };
}
