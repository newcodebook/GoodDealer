import assert from "node:assert/strict";
import test from "node:test";

import {
  R0_11_REQUIRED_EVIDENCE_SETS,
  gateClosureAttestationErrors,
  validateGateClosureAttestation,
} from "./gate-closure-policy.mjs";

const implementerRef = "github-user-id:1001";
const reviewerRef = "github-user-id:2002";
const approverRef = "github-user-id:3003";
const digest = "a".repeat(64);

function validAttestation() {
  return {
    schema_version: 1,
    attestation_id: "urn:gooddealer:gate-attestation:123e4567-e89b-42d3-a456-426614174000",
    gate_id: "R0-11",
    subject_commit: "b".repeat(40),
    implementation_refs: [implementerRef],
    evidence_sets: R0_11_REQUIRED_EVIDENCE_SETS.map((identity, index) => ({
      ...identity,
      manifest_sha256: digest,
      artifact: {
        artifact_id: String(9000 + index),
        artifact_digest: digest,
        run_url: `https://github.com/newcodebook/GoodDealer/actions/runs/${8000 + index}`,
        job_url: `https://github.com/newcodebook/GoodDealer/actions/runs/${8000 + index}/job/${7000 + index}`,
      },
      archive: {
        archive_ref: `urn:gooddealer:worm:r0-11-${index}`,
        archive_sha256: digest,
        verified_at: "2026-08-16T00:00:00Z",
        verified_by_ref: reviewerRef,
        retention_policy: {
          mode: "content-addressed-worm",
          policy_ref: "urn:gooddealer:retention:phase0-audit",
          retain_until: "2036-08-16T00:00:00Z",
        },
      },
    })),
    owner: { role: "Release Engineering Lead", ref: implementerRef },
    reviews: [{
      role: "Architecture Reviewer",
      ref: reviewerRef,
      reviewed_at: "2026-08-16T01:00:00Z",
      independence_assertion: {
        implementation_refs: [implementerRef],
        independently_verified: true,
      },
    }],
    approval: {
      role: "Phase 0 Gate Approver",
      ref: approverRef,
      approved_at: "2026-08-16T02:00:00Z",
    },
  };
}

test("accepts only the complete R0-11 evidence, archive, review, and approval packet", () => {
  assert.deepEqual(
    validateGateClosureAttestation(validAttestation(), { now: new Date("2026-08-16T03:00:00Z") }),
    { valid: true, errors: [] },
  );
});

test("fails closed when the deferred Windows 11 real-device evidence is missing", () => {
  const value = validAttestation();
  value.evidence_sets.pop();
  assert.equal(validateGateClosureAttestation(value).valid, false);
});

test("rejects implementer self-review and self-approval", () => {
  const value = validAttestation();
  value.reviews[0].ref = implementerRef;
  value.approval.ref = implementerRef;
  const errors = gateClosureAttestationErrors(value);
  assert.ok(errors.some((error) => error.includes("cannot approve")));
  assert.ok(errors.some((error) => error.includes("listed as an implementer")));
});

test("rejects transient Actions URLs and expired archive retention", () => {
  const value = validAttestation();
  value.evidence_sets[0].archive.archive_ref = value.evidence_sets[0].artifact.run_url;
  value.evidence_sets[0].archive.retention_policy.retain_until = "2026-08-16T02:30:00Z";
  const errors = gateClosureAttestationErrors(value, { now: new Date("2026-08-16T03:00:00Z") });
  assert.ok(errors.some((error) => error.includes("transient GitHub Actions URL")));
  assert.ok(errors.some((error) => error.includes("retention must extend")));
});

test("binds each job to its run and the archive to the transferred artifact bytes", () => {
  const value = validAttestation();
  value.evidence_sets[0].artifact.job_url = "https://github.com/newcodebook/GoodDealer/actions/runs/9999/job/7000";
  value.evidence_sets[0].archive.archive_sha256 = "c".repeat(64);
  const errors = gateClosureAttestationErrors(value);
  assert.ok(errors.some((error) => error.includes("job_url does not belong")));
  assert.ok(errors.some((error) => error.includes("archive digest does not match")));
});

test("rejects incomplete independence assertions and unknown fields", () => {
  const value = validAttestation();
  value.implementation_refs.push("github-user-id:1002");
  assert.ok(gateClosureAttestationErrors(value).some((error) => error.includes("complete implementation_refs")));
  value.unreviewed = true;
  assert.ok(gateClosureAttestationErrors(value).some((error) => error.includes("additional properties")));
});
