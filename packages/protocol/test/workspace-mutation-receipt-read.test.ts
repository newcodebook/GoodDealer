import { describe, expect, it } from "vitest";

import {
  MAX_WORKSPACE_MUTATION_RECEIPT_READ_IDS,
  workspaceMutationReceiptReadRequestSchema,
  workspaceMutationReceiptReadResponseSchema,
} from "../src/workspace/index";

const receipt = {
  mutationId: "mutation-1",
  activeLeaseEpoch: 3,
  deviceMutationSequence: 9,
  wireSchemaVersion: 2,
  wireMutationDigest: "A".repeat(43),
  outcome: "rejected",
} as const;

describe("own-device mutation receipt read (ADR-0032 receipt verification)", () => {
  it("names mutations only, never a device, and bounds the batch", () => {
    const ids = Array.from({ length: MAX_WORKSPACE_MUTATION_RECEIPT_READ_IDS }, (_, index) => `m-${index}`);
    expect(workspaceMutationReceiptReadRequestSchema.parse({ schemaVersion: 1, mutationIds: ids }).mutationIds).toHaveLength(256);
    for (const hostile of [
      { schemaVersion: 1, mutationIds: [] },
      { schemaVersion: 1, mutationIds: [...ids, "m-extra"] },
      { schemaVersion: 1, mutationIds: ["m-1", "m-1"] },
      { schemaVersion: 1, mutationIds: ["m-1"], sourceDeviceId: "device-other" },
      { schemaVersion: 2, mutationIds: ["m-1"] },
      { schemaVersion: 1, mutationIds: [""] },
    ]) {
      expect(workspaceMutationReceiptReadRequestSchema.safeParse(hostile).success).toBe(false);
    }
  });

  it("accepts only v2 or v3 envelopes with a SHA-256 digest, each mutation once", () => {
    expect(workspaceMutationReceiptReadResponseSchema.parse({ schemaVersion: 1, receipts: [receipt, { ...receipt, mutationId: "mutation-2", wireSchemaVersion: 3, outcome: "accepted" }] }).receipts).toHaveLength(2);
    expect(workspaceMutationReceiptReadResponseSchema.parse({ schemaVersion: 1, receipts: [] }).receipts).toEqual([]);
    for (const hostile of [
      [{ ...receipt, wireSchemaVersion: 1 }],
      [{ ...receipt, wireMutationDigest: "A".repeat(42) }],
      [{ ...receipt, outcome: "pending" }],
      [{ ...receipt, activeLeaseEpoch: 0 }],
      [{ ...receipt, sourceDeviceId: "device-other" }],
      [receipt, receipt],
    ]) {
      expect(workspaceMutationReceiptReadResponseSchema.safeParse({ schemaVersion: 1, receipts: hostile }).success).toBe(false);
    }
  });
});
