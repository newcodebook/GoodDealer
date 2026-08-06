import type { RuntimeStatusPort } from "@gooddealer/client-core";
import { runtimeStatusSchema } from "@gooddealer/protocol/devices";
import { invoke } from "@tauri-apps/api/core";

const RUNTIME_STATUS_COMMAND = "runtime_status";

export function createRuntimeStatusPort(): RuntimeStatusPort {
  return {
    async getStatus() {
      const response: unknown = await invoke(RUNTIME_STATUS_COMMAND);
      return runtimeStatusSchema.parse(response);
    },
  };
}
