import { invoke } from "@tauri-apps/api/core";
import { parseCloudflareRegistrarAccountStatus, cloudflareRegistrarAccountIntentSchema, type CloudflareRegistrarAccountPort } from "@gooddealer/client-core";

export function createCloudflareRegistrarAccountPort(): CloudflareRegistrarAccountPort {
  return {
    async status() {
      return parseCloudflareRegistrarAccountStatus(await invoke("cloudflare_registrar_account_status"));
    },
    async submit(intent) {
      const parsed = cloudflareRegistrarAccountIntentSchema.safeParse(intent);
      if (!parsed.success) throw new TypeError("invalid Cloudflare Registrar account intent");
      const wire = new TextEncoder().encode(JSON.stringify(parsed.data));
      await invoke("cloudflare_registrar_account_submit", wire);
    },
  };
}
