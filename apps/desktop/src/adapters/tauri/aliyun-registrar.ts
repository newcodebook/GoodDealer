import { invoke } from "@tauri-apps/api/core";
import { parseAliyunRegistrarStatus, aliyunRegistrarIntentSchema, type AliyunRegistrarPort } from "@gooddealer/client-core";

export function createAliyunRegistrarPort(): AliyunRegistrarPort {
  return {
    async status() {
      return parseAliyunRegistrarStatus(await invoke("aliyun_registrar_status"));
    },
    async submit(intent) {
      const parsed = aliyunRegistrarIntentSchema.safeParse(intent);
      if (!parsed.success) throw new TypeError("invalid Aliyun registrar intent");
      const wire = new TextEncoder().encode(JSON.stringify(parsed.data));
      await invoke("aliyun_registrar_submit", wire);
    },
  };
}
