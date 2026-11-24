import { invoke } from "@tauri-apps/api/core";
import { parsePorkbunRegistrarStatus, porkbunRegistrarIntentSchema, type PorkbunRegistrarPort } from "@gooddealer/client-core";

export function createPorkbunRegistrarPort(): PorkbunRegistrarPort {
  return {
    async status() {
      return parsePorkbunRegistrarStatus(await invoke("porkbun_registrar_status"));
    },
    async submit(intent) {
      const parsed = porkbunRegistrarIntentSchema.safeParse(intent);
      if (!parsed.success) throw new TypeError("invalid Porkbun registrar intent");
      const wire = new TextEncoder().encode(JSON.stringify(parsed.data));
      await invoke("porkbun_registrar_submit", wire);
    },
  };
}
