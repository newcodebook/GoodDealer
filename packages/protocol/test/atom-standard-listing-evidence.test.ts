import { describe, expect, it } from "vitest";
import {
  atomStandardListingItemApprovalSchema,
  atomStandardListingReconciledAuditPayloadSchema,
  encodeAtomStandardListingItemApprovalSignatureTranscript,
} from "../src/execution-events/atom-standard-listing-evidence";
import { encodeAtomStandardDelistItemApprovalSignatureTranscript } from "../src/execution-events/atom-standard-delist-evidence";
import { encodeSellerHubCreateListingItemApprovalSignatureTranscript } from "../src/execution-events/sellerhub-create-listing-evidence";

const id = "11111111-1111-4111-a111-111111111111";
const digest = "A".repeat(43);
const approval = {
  schemaVersion: 1,
  typ: "gd.atom-standard-listing-item-approval.v1",
  aud: "gooddealer-cloud/execution-evidence",
  approvedOperationId: id,
  operationId: id,
  planId: id,
  planHash: digest,
  targetCount: 1,
  targetSetDigest: digest,
  operationItemId: id,
  capability: "atom:marketplace:write",
  action: "add_standard",
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
  approvedAt: "2026-11-24T00:00:00Z",
  signatureTranscriptVersion: 1,
  deviceSignature: "A".repeat(86),
};

describe("Atom Standard listing evidence", () => {
  it("signs a purpose distinct from Atom delist and SellerHub creation", () => {
    expect(atomStandardListingItemApprovalSchema.parse(approval)).toEqual(approval);
    const delist = { ...approval, action: "remove_standard", typ: "gd.atom-standard-delist-item-approval.v1" };
    const sellerHub = {
      ...approval, action: "create_listing", typ: "gd.sellerhub-create-listing-item-approval.v1",
      capability: "spaceship:marketplace:write",
    };
    expect(encodeAtomStandardListingItemApprovalSignatureTranscript(approval))
      .not.toEqual(encodeAtomStandardDelistItemApprovalSignatureTranscript(delist));
    expect(() => encodeAtomStandardListingItemApprovalSignatureTranscript(delist)).toThrow();
    expect(() => encodeAtomStandardDelistItemApprovalSignatureTranscript(approval)).toThrow();
    expect(() => encodeAtomStandardListingItemApprovalSignatureTranscript(sellerHub)).toThrow();
    expect(() => encodeSellerHubCreateListingItemApprovalSignatureTranscript(approval)).toThrow();
  });

  it("refuses Premium, Geo, other capabilities and extra fields such as a token or price", () => {
    for (const change of [
      { action: "add_premium" }, { action: "add_geo" }, { capability: "atom:marketplace:observe" },
      { apiToken: "refuse" }, { priceMicroUsd: 1_000_000 }, { targetCount: 501 },
    ]) {
      expect(atomStandardListingItemApprovalSchema.safeParse({ ...approval, ...change }).success, JSON.stringify(change)).toBe(false);
    }
  });

  it("keeps verification pending distinct from a confirmed Standard listing", () => {
    const reconciliation = {
      schemaVersion: 1, provider: "atom", action: "add_standard", stage: "reconciled",
      operationId: id, operationItemId: id, attemptId: id,
      originalExecutionFactId: id, originalExecutionFactDigest: digest,
      originalSourceDeviceId: "device-a", originalActiveLeaseEpoch: 1,
    };
    const result = atomStandardListingReconciledAuditPayloadSchema;
    expect(result.safeParse({ ...reconciliation, outcome: "verification_pending", reason: "ownership_verifying" }).success).toBe(true);
    expect(result.safeParse({ ...reconciliation, outcome: "listed", reason: null }).success).toBe(true);
    expect(result.safeParse({ ...reconciliation, outcome: "listed", reason: "ownership_verifying" }).success).toBe(false);
    expect(result.safeParse({ ...reconciliation, outcome: "listed", reason: null, provider: "spaceship" }).success).toBe(false);
    expect(result.safeParse({ ...reconciliation, outcome: "listed", reason: null, listingType: "premium" }).success).toBe(false);
  });
});
