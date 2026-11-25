import { invoke } from "@tauri-apps/api/core";
import {
  afternicListingPlanApproveRequestSchema, afternicListingPlanPreviewRequestSchema,
  afternicListingPlanStatusRequestSchema, copyPlainData, parseAfternicListingPlan,
  parseAfternicListingPlanStatus, type AfternicListingPlanPort,
} from "@gooddealer/client-core";

export function createAfternicListingPlanPort(): AfternicListingPlanPort {
  const wire = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  return {
    async preview(request) {
      const intent = afternicListingPlanPreviewRequestSchema.safeParse(copyPlainData(request));
      if (!intent.success) throw new TypeError("invalid Afternic listing plan preview intent");
      const plan = parseAfternicListingPlan(await invoke("afternic_listing_plan_preview", wire(intent.data)));
      const expected = new Map(intent.data.items.map(item => [item.domain, item]));
      if (plan.state !== "awaiting_approval" || plan.action !== intent.data.action || plan.items.length !== expected.size
        || plan.items.some(item => {
          const target = expected.get(item.domain);
          if (target === undefined) return true;
          if (!("ownershipReview" in target)) return item.ownershipReview === null || item.listingWrite !== null;
          if ((target.ownershipReview === null) !== (item.ownershipReview === null) || item.listingWrite === null) return true;
          const changes = "values" in target ? target.values : target.patch;
          const returned = item.listingWrite.changes;
          return Object.keys(returned).length !== Object.keys(changes).length
            || Object.entries(changes).some(([key, value]) => returned[key as keyof typeof changes] !== value);
        })) throw new TypeError("Afternic listing plan preview response does not match request");
      return plan;
    },
    async approve(request) {
      const intent = afternicListingPlanApproveRequestSchema.safeParse(copyPlainData(request));
      if (!intent.success) throw new TypeError("invalid Afternic listing plan approval intent");
      const plan = parseAfternicListingPlan(await invoke("afternic_listing_plan_approve", wire(intent.data)));
      if (plan.planRef !== intent.data.planRef || plan.planHash !== intent.data.planHash || plan.approvedAt === null)
        throw new TypeError("Afternic listing plan approval response does not match request");
      return plan;
    },
    async status(request) {
      const intent = afternicListingPlanStatusRequestSchema.safeParse(copyPlainData(request));
      if (!intent.success) throw new TypeError("invalid Afternic listing plan status intent");
      const status = parseAfternicListingPlanStatus(await invoke("afternic_listing_plan_status", wire(intent.data)));
      if ((status.detail?.planRef ?? null) !== intent.data.planRef)
        throw new TypeError("Afternic listing plan status response does not match request");
      return status;
    },
  };
}
