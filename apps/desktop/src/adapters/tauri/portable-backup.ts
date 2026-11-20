import { invoke } from "@tauri-apps/api/core";
import { parsePortableBackupResult, portableBackupIntentSchema, type PortableBackupIntent } from "@gooddealer/client-core";

export async function runPortableBackup(intent: PortableBackupIntent) {
  const body = new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1,
    intent: portableBackupIntentSchema.parse(intent),
  }));
  return parsePortableBackupResult(await invoke<unknown>("local_portable_backup", body));
}
