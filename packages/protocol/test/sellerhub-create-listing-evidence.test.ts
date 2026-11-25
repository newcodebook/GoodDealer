import { describe, expect, it } from "vitest";
import {
  encodeSellerHubCreateListingItemApprovalSignatureTranscript,
  sellerHubCreateListingItemApprovalSchema,
  sellerHubCreateListingReconciledAuditPayloadSchema,
} from "../src/execution-events/sellerhub-create-listing-evidence";
import {
  encodeSellerHubBinPriceItemApprovalSignatureTranscript,
} from "../src/execution-events/sellerhub-bin-price-evidence";

const id = "11111111-1111-4111-a111-111111111111";
const digest = "A".repeat(43);
const approval = {
  schemaVersion: 1,
  typ: "gd.sellerhub-create-listing-item-approval.v1",
  aud: "gooddealer-cloud/execution-evidence",
  approvedOperationId: id,
  operationId: id,
  planId: id,
  planHash: digest,
  targetCount: 1,
  targetSetDigest: digest,
  operationItemId: id,
  capability: "spaceship:marketplace:write",
  action: "create_listing",
  requestDigest: digest,
  accountId: "account-a",
  workspaceId: "workspace-a",
  sourceDeviceId: "device-a",
  activeLeaseEpoch: 1,
  credentialEpoch: 1,
  signingKeyId: "key-a",
  signingKeyVersion: 1,
  authorizationHash: digest,
  trustedTimeAnchorId: digest,
  monotonicDeltaMs: 0,
  approvedAt: "2026-11-20T00:00:00Z",
  signatureTranscriptVersion: 1,
  deviceSignature: "A".repeat(86),
};

describe("SellerHub create listing evidence", () => {
  it("signs a distinct purpose and refuses existing BIN price approval envelopes", () => {
    expect(sellerHubCreateListingItemApprovalSchema.parse(approval)).toEqual(approval);
    const bin = { ...approval, action: "set_bin_price", typ: "gd.sellerhub-bin-price-item-approval.v1" };
    expect(encodeSellerHubCreateListingItemApprovalSignatureTranscript(approval))
      .not.toEqual(encodeSellerHubBinPriceItemApprovalSignatureTranscript(bin));
    expect(() => encodeSellerHubCreateListingItemApprovalSignatureTranscript(bin)).toThrow();
    expect(() => encodeSellerHubBinPriceItemApprovalSignatureTranscript(approval)).toThrow();
    expect(sellerHubCreateListingItemApprovalSchema.safeParse({ ...approval, cookie: "refuse" }).success).toBe(false);
  });

  it("keeps ownership pending distinct from publication and refuses arbitrary DNS fields", () => {
    const reconciliation = {
      schemaVersion: 1, provider: "spaceship", action: "create_listing", stage: "reconciled",
      operationId: id, operationItemId: id, attemptId: id,
      originalExecutionFactId: id, originalExecutionFactDigest: digest,
      originalSourceDeviceId: "device-a", originalActiveLeaseEpoch: 1,
    };
    const result = sellerHubCreateListingReconciledAuditPayloadSchema;
    expect(result.safeParse({ ...reconciliation, outcome: "ownership_pending", reason: "ownership_verifying" }).success).toBe(true);
    expect(result.safeParse({ ...reconciliation, outcome: "published", reason: null }).success).toBe(true);
    expect(result.safeParse({ ...reconciliation, outcome: "published", reason: "ownership_verifying" }).success).toBe(false);
    expect(result.safeParse({ ...reconciliation, outcome: "published", reason: null, txt: "refuse" }).success).toBe(false);
  });
});
