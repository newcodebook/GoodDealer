import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  afternicListingWriteItemApprovalSchema,
  encodeSellerHubBinPriceItemApprovalEnvelope,
  encodeSellerHubBinPriceItemApprovalSignatureTranscript,
  encodeSellerHubBinPriceTargetSetDigestInput,
  sellerHubBinPriceItemApprovalSchema,
  sellerHubBinPriceApprovalAuditPayloadSchema,
  sellerHubBinPriceClaimAuditPayloadSchema,
  sellerHubBinPriceClaimPayloadSchema,
  sellerHubBinPricePreflightRefusedAuditPayloadSchema,
  sellerHubBinPriceReconciledAuditPayloadSchema,
} from "../src/execution-events/index";

const vector = JSON.parse(readFileSync(new URL("../test-vectors/sellerhub-bin-price/approval.json", import.meta.url), "utf8"));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("base64url");

it("binds the exact immutable approval and its target set to separate SellerHub purposes", () => {
  expect(Buffer.from(encodeSellerHubBinPriceItemApprovalSignatureTranscript(vector.approval)).toString("hex"))
    .toBe(vector.approvalTranscript);
  expect(digest(encodeSellerHubBinPriceItemApprovalEnvelope(vector.approval))).toBe(vector.approvalEnvelopeDigest);
  expect(digest(encodeSellerHubBinPriceTargetSetDigestInput(vector.targetSet))).toBe(vector.approval.targetSetDigest);
  expect(() => encodeSellerHubBinPriceTargetSetDigestInput({
    ...vector.targetSet, items: [...vector.targetSet.items, ...vector.targetSet.items],
  })).toThrow();
});

it("rejects alternate providers, purposes, money actions and authority injected beside the digest", () => {
  expect(afternicListingWriteItemApprovalSchema.safeParse(vector.approval).success).toBe(false);
  for (const extra of [
    { capability: "afternic:marketplace:write" },
    { capability: "spaceship:registrar:observe" },
    { typ: "gd.afternic-listing-write-item-approval.v1" },
    { deviceSignature: "invalid" },
    { action: "purchase" },
    { amount: 100 },
    { targetCount: 501 },
  ]) expect(sellerHubBinPriceItemApprovalSchema.safeParse({ ...vector.approval, ...extra }).success).toBe(false);
});


it("keeps approval, local dispatch, refusal and prior-source reconciliation distinct", () => {
  const dispatch = JSON.parse(readFileSync(new URL("../test-vectors/sellerhub-bin-price/dispatch.json", import.meta.url), "utf8"));
  for (const [schema, payload] of [
    [sellerHubBinPriceApprovalAuditPayloadSchema, dispatch.approveAudit.payloadRedacted],
    [sellerHubBinPriceClaimAuditPayloadSchema, dispatch.claimAudit.payloadRedacted],
    [sellerHubBinPricePreflightRefusedAuditPayloadSchema, dispatch.preflightAudit.payloadRedacted],
    [sellerHubBinPriceReconciledAuditPayloadSchema, dispatch.reconciledAudit.payloadRedacted],
    [sellerHubBinPriceClaimPayloadSchema, dispatch.fact.payloadRedacted],
  ]) {
    expect(schema.safeParse(payload).success).toBe(true);
    expect(schema.safeParse({ ...payload, provider: "afternic" }).success).toBe(false);
    expect(schema.safeParse({ ...payload, amount: 1 }).success).toBe(false);
  }
  const { originalSourceDeviceId: _missing, ...withoutSource } = dispatch.reconciledAudit.payloadRedacted;
  expect(sellerHubBinPriceReconciledAuditPayloadSchema.safeParse(withoutSource).success).toBe(false);
  expect(sellerHubBinPriceReconciledAuditPayloadSchema.safeParse({
    ...dispatch.reconciledAudit.payloadRedacted, originalActiveLeaseEpoch: 0,
  }).success).toBe(false);
  expect(sellerHubBinPriceClaimPayloadSchema.safeParse({
    ...dispatch.fact.payloadRedacted, dispatchSemantics: "remote_write_succeeded",
  }).success).toBe(false);
});
