import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  afternicListingPlanApprovalAuditPayloadSchema, afternicListingPlanClaimAuditPayloadSchema,
  afternicListingPlanClaimPayloadSchema, afternicListingPlanPreflightRefusedAuditPayloadSchema,
  afternicListingPlanReconciledAuditPayloadSchema, afternicOwnershipReviewClaimAuditPayloadSchema,
  afternicOwnershipReviewClaimPayloadSchema, afternicOwnershipReviewPreflightRefusedAuditPayloadSchema,
  afternicOwnershipReviewReconciledAuditPayloadSchema, encodeDeviceAuditEventHashInput,
  encodeDeviceAuditEventSignatureTranscript, encodeExecutionFactSignatureTranscript, encodeDrainStreamEnvelope,
  deviceAuditIngestRequestSchema, executionFactIngestRequestSchema,
} from "../src/execution-events/index";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("base64url");
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe.each(["create", "update", "ownership-linked-create", "ownership-linked-update", "ownership-standalone"])("Afternic new evidence %s", name => {
  const v = JSON.parse(readFileSync(new URL(`../test-vectors/afternic-listing-plan-evidence/${name}.json`, import.meta.url), "utf8"));
  const ownership = name.startsWith("ownership-");
  const claim = ownership ? afternicOwnershipReviewClaimAuditPayloadSchema : afternicListingPlanClaimAuditPayloadSchema;
  const fact = ownership ? afternicOwnershipReviewClaimPayloadSchema : afternicListingPlanClaimPayloadSchema;
  const refused = ownership ? afternicOwnershipReviewPreflightRefusedAuditPayloadSchema : afternicListingPlanPreflightRefusedAuditPayloadSchema;
  const reconciled = ownership ? afternicOwnershipReviewReconciledAuditPayloadSchema : afternicListingPlanReconciledAuditPayloadSchema;
  const key = createPublicKey({ format: "der", type: "spki", key: Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(v.devicePublicKey, "base64url"),
  ]) });
  it("pins all signed audit/fact bytes and the exact new ingest contract", () => {
    for (const label of ["approvalAudit", "claimAudit", "preflightAudit", "reconciledAudit"]) {
      const audit = v[label];
      expect(hash(encodeDeviceAuditEventHashInput(audit))).toBe(audit.eventHash);
      expect(hex(encodeDeviceAuditEventHashInput(audit))).toBe(v.bytes[`${label}HashInput`]);
      expect(hex(encodeDeviceAuditEventSignatureTranscript(audit))).toBe(v.bytes[`${label}Transcript`]);
      expect(verify(null, encodeDeviceAuditEventSignatureTranscript(audit), key, Buffer.from(audit.deviceSignature, "base64url"))).toBe(true);
      expect(deviceAuditIngestRequestSchema.safeParse({ schemaVersion: 1, event: audit }).success).toBe(true);
    }
    expect(hex(encodeExecutionFactSignatureTranscript(v.fact))).toBe(v.bytes.factTranscript);
    expect(hex(encodeDrainStreamEnvelope("execution_fact", v.fact))).toBe(v.bytes.executionFactEnvelope);
    expect(verify(null, encodeExecutionFactSignatureTranscript(v.fact), key, Buffer.from(v.fact.deviceSignature, "base64url"))).toBe(true);
    expect(executionFactIngestRequestSchema.safeParse({ schemaVersion: 1, fact: v.fact }).success).toBe(true);
    expect(afternicListingPlanApprovalAuditPayloadSchema.parse(v.approvalAudit.payloadRedacted).targetCount).toBe(v.targetSet.items.length);
    expect(claim.safeParse(v.claimAudit.payloadRedacted).success).toBe(true);
    expect(fact.safeParse(v.fact.payloadRedacted).success).toBe(true);
    expect(refused.safeParse(v.preflightAudit.payloadRedacted).success).toBe(true);
    expect(reconciled.safeParse(v.reconciledAudit.payloadRedacted).success).toBe(true);
  });
  it("closes version, purpose, observation digest and secret-bearing payload fields", () => {
    for (const [schema, payload] of [[claim, v.claimAudit.payloadRedacted], [fact, v.fact.payloadRedacted], [refused, v.preflightAudit.payloadRedacted], [reconciled, v.reconciledAudit.payloadRedacted]] as const) {
      for (const change of [{ schemaVersion: ownership ? 2 : 1 }, { action: "remove" }, { cookie: "secret" }, { domain: "wecin.com" }, { parentItemId: null }, { parentRequestDigest: null }]) {
        expect(schema.safeParse({ ...payload, ...change }).success).toBe(false);
      }
    }
    for (const [schema, payload] of [[claim, v.claimAudit.payloadRedacted], [fact, v.fact.payloadRedacted]] as const) {
      for (const field of ["resourceBindingDigest", "preflightObservationDigest"]) {
        if (ownership) {
          const missing = { ...payload }; delete missing[field];
          expect(schema.safeParse(missing).success).toBe(false);
          expect(schema.safeParse({ ...payload, [field]: "a" }).success).toBe(false);
        } else expect(schema.safeParse({ ...payload, [field]: hash(Buffer.from("unexpected")) }).success).toBe(false);
      }
    }
    expect(afternicListingPlanApprovalAuditPayloadSchema.safeParse({ ...v.approvalAudit.payloadRedacted, action: v.approval.action }).success).toBe(false);
    expect(afternicListingPlanApprovalAuditPayloadSchema.safeParse({ ...v.approvalAudit.payloadRedacted, targetCount: 1001 }).success).toBe(false);
  });
  it("rejects legacy outer purposes and mismatched new versions at the ingest boundary", () => {
    for (const change of [
      { targetType: "afternic_listing_write_attempt" },
      { eventType: "runtime_security_lifecycle" },
      { authorizationSource: "runtime_security_context" },
      { payloadRedacted: { ...v.claimAudit.payloadRedacted, schemaVersion: ownership ? 2 : 1 } },
    ]) expect(deviceAuditIngestRequestSchema.safeParse({ schemaVersion: 1, event: { ...v.claimAudit, ...change } }).success).toBe(false);
    for (const change of [
      { eventType: "afternic_listing_write_dispatch_claimed" },
      { eventType: ownership ? "afternic_listing_plan_v2_dispatch_claimed" : "afternic_ownership_review_dispatch_claimed" },
      { payloadRedacted: { ...v.fact.payloadRedacted, schemaVersion: ownership ? 2 : 1 } },
    ]) expect(executionFactIngestRequestSchema.safeParse({ schemaVersion: 1, fact: { ...v.fact, ...change } }).success).toBe(false);
  });
  it("accepts only outcome/reason pairs that correspond to the observed result", () => {
    const pairs = ownership
      ? [["confirmed", null], ["still_review", "postcondition_pending"], ["read_failed", "read_failed"], ["conflict", "connection_changed"]]
      : [["matched", null], ["different", "postcondition_pending"], ["absent", "postcondition_pending"], ["read_failed", "read_failed"], ["conflict", "connection_changed"]];
    for (const [outcome, reason] of pairs) expect(reconciled.safeParse({ ...v.reconciledAudit.payloadRedacted, outcome, reason }).success).toBe(true);
    for (const change of [{ outcome: "active" }, { reason: "postcondition_pending" }, { outcome: "read_failed", reason: null }, { outcome: "conflict", reason: "postcondition_pending" }]) {
      expect(reconciled.safeParse({ ...v.reconciledAudit.payloadRedacted, ...change }).success).toBe(false);
    }
    expect(refused.safeParse({ ...v.preflightAudit.payloadRedacted, reason: ownership ? "already_present" : "cooldown" }).success).toBe(false);
  });
});

describe("ownership preflight can finish without a dispatch", () => {
  it("signs a distinct no-reason lifecycle event and contains no fictitious claim/fact", async () => {
    const { afternicOwnershipReviewPreflightSatisfiedAuditPayloadSchema } = await import("../src/execution-events/index");
    const v = JSON.parse(readFileSync(new URL("../test-vectors/afternic-listing-plan-evidence/ownership-preflight-satisfied.json", import.meta.url), "utf8"));
    const payload = v.satisfiedAudit.payloadRedacted;
    expect(deviceAuditIngestRequestSchema.safeParse({ schemaVersion: 1, event: v.satisfiedAudit }).success).toBe(true);
    expect(afternicOwnershipReviewPreflightSatisfiedAuditPayloadSchema.parse(payload).stage).toBe("preflight_satisfied");
    expect(v.claimAudit).toBeUndefined(); expect(v.fact).toBeUndefined();
    expect(v.satisfiedAudit.previousHash).toBe(v.approvalAudit.eventHash);
    expect(hex(encodeDeviceAuditEventSignatureTranscript(v.satisfiedAudit))).toBe(v.bytes.satisfiedAuditTranscript);
    expect(hash(encodeDeviceAuditEventHashInput(v.satisfiedAudit))).toBe(v.satisfiedAudit.eventHash);
    const key = createPublicKey({ format: "der", type: "spki", key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(v.devicePublicKey, "base64url")]) });
    expect(verify(null, encodeDeviceAuditEventSignatureTranscript(v.satisfiedAudit), key, Buffer.from(v.satisfiedAudit.deviceSignature, "base64url"))).toBe(true);
    for (const changes of [{ reason: null }, { reason: "already_present" }, { action: "create" }, { schemaVersion: 2 }, { resourceBindingDigest: v.approval.requestDigest }, { providerStatus: "ACTIVE" }]) {
      expect(afternicOwnershipReviewPreflightSatisfiedAuditPayloadSchema.safeParse({ ...payload, ...changes }).success).toBe(false);
      expect(deviceAuditIngestRequestSchema.safeParse({ schemaVersion: 1, event: { ...v.satisfiedAudit, payloadRedacted: { ...payload, ...changes } } }).success).toBe(false);
    }
  });
});
