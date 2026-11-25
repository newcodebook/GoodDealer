import type { CloudMigration } from "../../../db/index";

/** M019 deliberately granted individual session columns; the device projection needs this one. */
export const executionContextDeviceColumnMigration: CloudMigration = {
  id: "202611190005-execution-context-device-column", owner: "identity",
  sql: `GRANT SELECT (device_id) ON public.identity_auth_sessions TO gd_identity_definer;`,
};
