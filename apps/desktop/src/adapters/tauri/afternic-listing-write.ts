import { invoke } from "@tauri-apps/api/core";
import {
  afternicListingWriteApproveRequestSchema, afternicListingWritePreviewRequestSchema,
  afternicListingWriteStatusRequestSchema, parseAfternicListingWritePlan, parseAfternicListingWriteStatus,
  copyPlainData, type AfternicListingWritePort,
} from "@gooddealer/client-core";

/** Only bounded intent crosses IPC; approval always names the exact persisted preview. */
export function createAfternicListingWritePort(): AfternicListingWritePort {
  const wire = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  return {
    async preview(request) {
      const intent = afternicListingWritePreviewRequestSchema.safeParse(copyPlainData(request));
      if (!intent.success) throw new TypeError("invalid Afternic listing write preview intent");
      const plan = parseAfternicListingWritePlan(await invoke("afternic_listing_write_preview", wire(intent.data)));
      const items = [...intent.data.items].sort((left, right) => left.domain < right.domain ? -1 : left.domain > right.domain ? 1 : 0);
      if (plan.state !== "awaiting_approval" || plan.approvedAt !== null || plan.action !== intent.data.action
        || plan.items.length !== items.length || plan.items.some((item, index) => {
          const expected = items[index]!;
          const changes = "values" in expected ? expected.values : expected.patch;
          return item.domain !== expected.domain || Object.keys(item.changes).length !== Object.keys(changes).length
            || Object.entries(changes).some(([key, value]) => item.changes[key as keyof typeof changes] !== value);
        })) throw new TypeError("Afternic listing write preview response does not match request");
      return plan;
    },
    async approve(request) {
      const intent = afternicListingWriteApproveRequestSchema.safeParse(copyPlainData(request));
      if (!intent.success) throw new TypeError("invalid Afternic listing write approval intent");
      const plan = parseAfternicListingWritePlan(await invoke("afternic_listing_write_approve", wire(intent.data)));
      if (plan.planRef !== intent.data.planRef || plan.planHash !== intent.data.planHash
        || plan.state === "awaiting_approval" || plan.state === "expired")
        throw new TypeError("Afternic listing write approval response does not match request");
      return plan;
    },
    async status(request) {
      const intent = afternicListingWriteStatusRequestSchema.safeParse(copyPlainData(request));
      if (!intent.success) throw new TypeError("invalid Afternic listing write status intent");
      const status = parseAfternicListingWriteStatus(await invoke("afternic_listing_write_status", wire(intent.data)));
      if (status.detail?.planRef !== (intent.data.planRef ?? undefined))
        throw new TypeError("Afternic listing write status response does not match request");
      return status;
    },
  };
}
