import { invoke } from "@tauri-apps/api/core";
import {
  parseSellerHubBinPriceApproval, parseSellerHubBinPricePlan, parseSellerHubBinPriceStatus,
  parseSellerHubStatus, sellerHubBinPriceApproveSchema, sellerHubBinPricePreviewSchema,
  sellerHubBinPriceStatusRequestSchema, sellerHubIntentSchema,
  type SellerHubBinPricePort, type SellerHubPort,
} from "@gooddealer/client-core";

export function createSellerHubPort(): SellerHubPort {
  return {
    async status() {
      return parseSellerHubStatus(await invoke("sellerhub_status"));
    },
    async submit(intent) {
      const parsed = sellerHubIntentSchema.safeParse(intent);
      if (!parsed.success) throw new TypeError("invalid SellerHub intent");
      const wire = new TextEncoder().encode(JSON.stringify(parsed.data));
      await invoke("sellerhub_submit", wire);
    },
  };
}

export function createSellerHubBinPricePort(): SellerHubBinPricePort {
  const body = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  return {
    async preview(request) {
      const input = sellerHubBinPricePreviewSchema.parse(request);
      const plan = parseSellerHubBinPricePlan(await invoke("sellerhub_bin_price_preview", body(input)));
      const targets = new Map(input.items.map(item => [item.domain, item.priceCents]));
      if (plan.state !== "awaiting_approval" || input.connectionId !== plan.connectionId
        || plan.items.length !== targets.size || plan.items.some(item => targets.get(item.domain) !== item.priceCents))
        throw new TypeError("SellerHub preview does not match request");
      return plan;
    },
    async approve(request) {
      return parseSellerHubBinPriceApproval(await invoke("sellerhub_bin_price_approve", body(sellerHubBinPriceApproveSchema.parse(request))));
    },
    async status(request) {
      const input = sellerHubBinPriceStatusRequestSchema.parse(request);
      const status = parseSellerHubBinPriceStatus(await invoke("sellerhub_bin_price_status", body(input)));
      if (input.planId !== null && input.planId !== status.plan?.planId)
        throw new TypeError("SellerHub status does not match request");
      return status;
    },
  };
}
