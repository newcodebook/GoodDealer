import { invoke } from "@tauri-apps/api/core";
import { afternicConnectIntentSchema, afternicConnectionIntentSchema, parseAfternicConnectionsStatus, type AfternicConnectionPort } from "@gooddealer/client-core";

/** Only bounded intent leaves the Renderer. Native owns capture, credentials and remote facts. */
export function createAfternicPort(): AfternicConnectionPort {
  const wire = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  return {
    async status() { return parseAfternicConnectionsStatus(await invoke("afternic_connection_status")); },
    async connect(displayLabel) {
      const intent = afternicConnectIntentSchema.safeParse({ schemaVersion: 1, displayLabel });
      if (!intent.success) throw new TypeError("invalid Afternic connection intent");
      await invoke("afternic_connection_connect", wire(intent.data));
    },
    async refresh(connectionId) {
      const intent = afternicConnectionIntentSchema.safeParse({ schemaVersion: 1, connectionId });
      if (!intent.success) throw new TypeError("invalid Afternic refresh intent");
      await invoke("afternic_inventory_refresh", wire(intent.data));
    },
    async revoke(connectionId) {
      const intent = afternicConnectionIntentSchema.safeParse({ schemaVersion: 1, connectionId });
      if (!intent.success) throw new TypeError("invalid Afternic revoke intent");
      await invoke("afternic_connection_revoke", wire(intent.data));
    },
  };
}
