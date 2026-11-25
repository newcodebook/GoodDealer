import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  afternicListingPlanItemApprovalSchema, afternicListingPlanTargetSetSchema, afternicOwnershipReviewItemApprovalSchema,
  afternicListingWriteItemApprovalSchema,
  encodeAfternicListingPlanItemApprovalEnvelope, encodeAfternicListingPlanItemApprovalSignatureTranscript,
  encodeAfternicListingPlanItemApprovalJson, decodeAfternicListingPlanItemApprovalJson,
  encodeAfternicOwnershipReviewItemApprovalEnvelope, encodeAfternicOwnershipReviewItemApprovalSignatureTranscript,
  encodeAfternicOwnershipReviewItemApprovalJson, decodeAfternicOwnershipReviewItemApprovalJson,
  encodeAfternicListingPlanTargetSetDigestInput, encodeAfternicListingWriteItemApprovalSignatureTranscript,
} from "../src/execution-events/index";

const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("base64url");
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../test-vectors/afternic-listing-plan-evidence/${name}.json`, import.meta.url), "utf8"));
const names = ["create", "update", "ownership-linked-create", "ownership-linked-update", "ownership-standalone"];

describe.each(names)("Afternic listing plan approval %s", name => {
  const v = fixture(name);
  const ownership = name.startsWith("ownership-");
  const schema = ownership ? afternicOwnershipReviewItemApprovalSchema : afternicListingPlanItemApprovalSchema;
  const transcript = ownership ? encodeAfternicOwnershipReviewItemApprovalSignatureTranscript : encodeAfternicListingPlanItemApprovalSignatureTranscript;
  const envelope = ownership ? encodeAfternicOwnershipReviewItemApprovalEnvelope : encodeAfternicListingPlanItemApprovalEnvelope;
  const json = ownership ? encodeAfternicOwnershipReviewItemApprovalJson : encodeAfternicListingPlanItemApprovalJson;
  const decode = ownership ? decodeAfternicOwnershipReviewItemApprovalJson : decodeAfternicListingPlanItemApprovalJson;
  const key = createPublicKey({ format: "der", type: "spki", key: Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(v.devicePublicKey, "base64url"),
  ]) });
  const verifies = (bytes: Uint8Array) => verify(null, bytes, key, Buffer.from(v.approval.deviceSignature, "base64url"));

  it("pins canonical bytes, SHA256 and genuine purpose-bound signatures", () => {
    expect(hex(transcript(v.approval))).toBe(v.bytes.approvalTranscript);
    expect(hex(envelope(v.approval))).toBe(v.bytes.approvalEnvelope);
    expect(hex(json(v.approval))).toBe(v.bytes.approvalJson);
    expect(hex(encodeAfternicListingPlanTargetSetDigestInput(v.targetSet))).toBe(v.bytes.targetSet);
    expect(hash(envelope(v.approval))).toBe(v.approvalEnvelopeDigest);
    expect(hash(encodeAfternicListingPlanTargetSetDigestInput(v.targetSet))).toBe(v.approval.targetSetDigest);
    expect(v.approval.targetCount).toBe(v.targetSet.items.length);
    expect(verifies(transcript(v.approval))).toBe(true);
    expect(decode(json(v.approval))).toEqual(v.approval);
    const reordered = Object.fromEntries(Object.entries(v.approval).reverse());
    expect(hex(transcript(reordered))).toBe(v.bytes.approvalTranscript);
  });

  it("binds account, tenant, device, authority epoch, time, item and exact plan", () => {
    for (const change of [
      { accountId: "other-account" }, { workspaceId: "other-workspace" }, { sourceDeviceId: "other-device" },
      { activeLeaseEpoch: v.approval.activeLeaseEpoch + 1 }, { credentialEpoch: v.approval.credentialEpoch + 1 },
      { operationItemId: id(90) }, { operationId: id(91) }, { planId: id(92) }, { approvedOperationId: id(93) },
      { planHash: hash(Buffer.from("other-plan")) }, { requestDigest: hash(Buffer.from("other-request")) },
      { targetSetDigest: hash(Buffer.from("other-set")) }, { targetCount: v.approval.targetCount + 1 },
      { monotonicDeltaMs: 1001 }, { approvedAt: "2026-11-20T00:00:00Z" },
    ]) expect(verifies(transcript({ ...v.approval, ...change }))).toBe(false);
  });

  it("cannot reuse a legacy or other-purpose signature", () => {
    const { parentItemId: _parent, parentRequestDigest: _digest, ...oldFields } = v.approval;
    const legacy = { ...oldFields, schemaVersion: 1, typ: "gd.afternic-listing-write-item-approval.v1", action: "create" };
    expect(verifies(encodeAfternicListingWriteItemApprovalSignatureTranscript(legacy))).toBe(false);
    const other = ownership
      ? { ...v.approval, schemaVersion: 2, typ: "gd.afternic-listing-plan-item-approval.v2", action: "create", parentItemId: null, parentRequestDigest: null }
      : { ...v.approval, schemaVersion: 1, typ: "gd.afternic-ownership-review-item-approval.v1", action: "reactivate_ownership_review" };
    const otherTranscript = ownership ? encodeAfternicListingPlanItemApprovalSignatureTranscript : encodeAfternicOwnershipReviewItemApprovalSignatureTranscript;
    expect(verifies(otherTranscript(other))).toBe(false);
    expect(afternicListingWriteItemApprovalSchema.safeParse(v.approval).success).toBe(false);
    expect(schema.safeParse(other).success).toBe(false);
  });

  it("rejects widened authority, missing nullable fields and invalid scalar boundaries", () => {
    for (const change of [
      { cookie: "secret-canary" }, { domain: "wecin.com" }, { providerAccount: "private" },
      { action: "remove" }, { typ: "gd.afternic-delist-item-approval.v1" }, { aud: "provider" },
      { schemaVersion: 3 }, { targetCount: 0 }, { targetCount: 1001 }, { targetCount: 1.5 },
      { activeLeaseEpoch: 0 }, { credentialEpoch: Number.MAX_SAFE_INTEGER + 1 },
      { requestDigest: "=".repeat(43) }, { deviceSignature: "x".repeat(86) },
      { parentItemId: undefined }, { parentRequestDigest: undefined },
    ]) expect(schema.safeParse({ ...v.approval, ...change }).success).toBe(false);
    for (const field of ["parentItemId", "parentRequestDigest"]) {
      const missing = { ...v.approval }; delete missing[field];
      expect(schema.safeParse(missing).success).toBe(false);
    }
  });

  it("refuses duplicate JSON keys including escaped aliases, malformed UTF8 and oversized bytes", () => {
    const text = JSON.stringify(v.approval);
    for (const key of ['"action"', '"\\u0061ction"', '"parentItemId"', '"schemaVersion"']) {
      expect(() => decode(Buffer.from(`{${key}:null,${text.slice(1)}`))).toThrow("duplicate");
    }
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(6145), Buffer.from([255]), Buffer.from("null"), Buffer.from("[]"), Buffer.from("{}"), Buffer.from(text + "null")]) {
      expect(() => decode(bytes)).toThrow();
    }
  });
});

describe("Afternic listing plan exact target relationships", () => {
  const v = fixture("ownership-linked-create");
  const [parent, child] = v.targetSet.items;
  const accepts = (items: unknown[]) => afternicListingPlanTargetSetSchema.safeParse({ ...v.targetSet, items }).success;

  it("requires sorted unique IDs and exact parents in the same set", () => {
    expect(accepts([parent, child])).toBe(true);
    for (const items of [
      [], [child, parent], [parent, parent], [child],
      [parent, { ...child, parentItemId: id(999) }],
      [parent, { ...child, parentRequestDigest: hash(Buffer.from("other-parent")) }],
      [parent, { ...child, parentItemId: child.operationItemId }],
      [parent, child, { ...child, operationItemId: id(6) }],
      [parent, { ...child, action: "update" }],
      [{ ...parent, action: "reactivate_ownership_review" }, child],
      [parent, { ...child, parentItemId: null }],
      [parent, { ...child, parentRequestDigest: null }],
    ]) expect(accepts(items)).toBe(false);
    expect(accepts([{ ...child, parentItemId: null, parentRequestDigest: null }])).toBe(true);
    expect(afternicListingPlanTargetSetSchema.safeParse({ ...v.targetSet, schemaVersion: 1 }).success).toBe(false);
    expect(afternicListingPlanTargetSetSchema.safeParse({ ...v.targetSet, action: "create" }).success).toBe(false);
    expect(afternicListingPlanTargetSetSchema.safeParse({ ...v.targetSet, domain: "wecin.com" }).success).toBe(false);
    expect(accepts([{ ...parent, secret: "canary" }])).toBe(false);
  });

  it("supports at most 500 independent targets and 1000 total items", () => {
    const roots = Array.from({ length: 500 }, (_, i) => ({ ...parent, operationItemId: id(i + 1), requestDigest: hash(Buffer.from(`request-${i}`)) }));
    const children = roots.map((p, i) => ({ ...child, operationItemId: id(i + 501), parentItemId: p.operationItemId, parentRequestDigest: p.requestDigest }));
    expect(accepts(roots)).toBe(true);
    expect(accepts([...roots, ...children])).toBe(true);
    expect(accepts([...roots, { ...parent, operationItemId: id(501) }])).toBe(false);
    expect(accepts([...roots, ...children, { ...child, operationItemId: id(1001) }])).toBe(false);
  });

  it("ordinary items never carry parent authority and ownership parent pairs are inseparable", () => {
    const ordinary = fixture("create").approval;
    expect(afternicListingPlanItemApprovalSchema.safeParse({ ...ordinary, parentItemId: id(99), parentRequestDigest: parent.requestDigest }).success).toBe(false);
    for (const change of [{ parentItemId: null }, { parentRequestDigest: null }, { parentItemId: child.operationItemId }]) {
      expect(afternicOwnershipReviewItemApprovalSchema.safeParse({ ...v.approval, ...change }).success).toBe(false);
    }
  });
});
