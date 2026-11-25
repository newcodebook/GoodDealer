import { invoke } from "@tauri-apps/api/core";
import {
  afternicDelistApproveRequestSchema, afternicDelistPreviewRequestSchema,
  afternicDelistStatusRequestSchema, parseAfternicDelistPlan, parseAfternicDelistStatus,
  copyPlainData,
  type AfternicDelistPort,
} from "@gooddealer/client-core";

/** A persisted plan reference binds approval; neither credentials nor Provider requests cross IPC. */
export function createAfternicDelistPort(): AfternicDelistPort {
  const wire = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  return {
    async preview(request) {
      const intent = afternicDelistPreviewRequestSchema.safeParse(copyPlainData(request));
      if (!intent.success) throw new TypeError("invalid Afternic delist preview intent");
      const plan = parseAfternicDelistPlan(await invoke("afternic_delist_preview", wire(intent.data)));
      const domains = [...intent.data.domains].sort();
      if (plan.state !== "awaiting_approval" || plan.approvedAt !== null
        || plan.items.length !== domains.length || plan.items.some((item, index) => item.domain !== domains[index])) {
        throw new TypeError("Afternic delist preview response does not match request");
      }
      return plan;
    },
    async approve(request) {
      const intent = afternicDelistApproveRequestSchema.safeParse(copyPlainData(request));
      if (!intent.success) throw new TypeError("invalid Afternic delist approval intent");
      const plan = parseAfternicDelistPlan(await invoke("afternic_delist_approve", wire(intent.data)));
      if (plan.planRef !== intent.data.planRef || plan.planHash !== intent.data.planHash
        || plan.state === "awaiting_approval" || plan.state === "expired") {
        throw new TypeError("Afternic delist approval response does not match request");
      }
      return plan;
    },
    async status(request) {
      const intent = afternicDelistStatusRequestSchema.safeParse(copyPlainData(request));
      if (!intent.success) throw new TypeError("invalid Afternic delist status intent");
      const status = parseAfternicDelistStatus(await invoke("afternic_delist_status", wire(intent.data)));
      if (status.detail?.planRef !== (intent.data.planRef ?? undefined)) {
        throw new TypeError("Afternic delist status response does not match request");
      }
      return status;
    },
  };
}
