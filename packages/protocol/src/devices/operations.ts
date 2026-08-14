import { z } from "zod";

export const deviceOperationSchema = z.enum([
  "devices.bindings.list",
  "devices.binding.remove",
  "devices.lease.status",
  "devices.switch.request",
  "devices.switch.status",
]);

export type DeviceOperation = z.infer<typeof deviceOperationSchema>;
