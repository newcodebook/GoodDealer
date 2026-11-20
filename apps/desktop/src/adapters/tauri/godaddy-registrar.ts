import { invoke } from "@tauri-apps/api/core";
import { parseGoDaddyRegistrarStatus, godaddyRegistrarIntentSchema, type GoDaddyRegistrarPort } from "@gooddealer/client-core";

export function createGoDaddyRegistrarPort(): GoDaddyRegistrarPort {
  return {
    async status() {
      return parseGoDaddyRegistrarStatus(await invoke("godaddy_registrar_status"));
    },
    async submit(intent) {
      const parsed = godaddyRegistrarIntentSchema.safeParse(intent);
      if (!parsed.success) throw new TypeError("invalid GoDaddy registrar intent");
      const wire = new TextEncoder().encode(JSON.stringify(parsed.data));
      await invoke("godaddy_registrar_submit", wire);
    },
  };
}
