import { invoke } from "@tauri-apps/api/core";
import { parseSedoMarketplaceStatus, sedoMarketplaceIntentSchema, type SedoMarketplacePort } from "@gooddealer/client-core";

export function createSedoMarketplacePort(): SedoMarketplacePort {
  return {
    async status() {
      return parseSedoMarketplaceStatus(await invoke("sedo_marketplace_status"));
    },
    async submit(intent) {
      const parsed = sedoMarketplaceIntentSchema.safeParse(intent);
      if (!parsed.success) throw new TypeError("invalid Sedo seller portfolio intent");
      const wire = new TextEncoder().encode(JSON.stringify(parsed.data));
      await invoke("sedo_marketplace_submit", wire);
    },
  };
}
