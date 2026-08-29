import { z } from "zod";

import { DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID } from "./authorization-grant";

export const deviceOperationSchema = z.enum([
  DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID,
  "devices.bindings.list",
  "devices.binding.remove",
  "devices.lease.status",
  "devices.switch.request",
  "devices.switch.status",
]);

export type DeviceOperation = z.infer<typeof deviceOperationSchema>;
