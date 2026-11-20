import { invoke } from "@tauri-apps/api/core";
import { parseSellerHubStatus, sellerHubIntentSchema, type SellerHubPort } from "@gooddealer/client-core";

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
