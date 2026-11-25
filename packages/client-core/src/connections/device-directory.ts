import { z } from "zod";
import { canonicalUtcTimestamp, displayLabel, identifier, safePositiveInteger } from "@gooddealer/protocol/wire";
import { copyPlainData } from "../portfolio/index";

/** A display projection, never a Lease, key or handoff capability. */
export const deviceDirectoryViewSchema = z.object({
  schemaVersion: z.literal(1),
  listRevision: safePositiveInteger,
  devices: z.array(z.object({
    deviceId: identifier,
    displayName: displayLabel.nullable(),
    platform: z.enum(["windows", "macos", "linux", "ios", "android"]).nullable(),
    status: z.enum(["bound", "removed"]),
    role: z.enum(["active", "standby", "none"]),
    currentDevice: z.boolean(),
    lastSeenAt: canonicalUtcTimestamp.nullable(),
  }).strict()).min(1).max(8),
}).strict().superRefine((view, context) => {
  if (new Set(view.devices.map((device) => device.deviceId)).size !== view.devices.length
    || view.devices.filter((device) => device.currentDevice).length !== 1
    || view.devices.filter((device) => device.role === "active").length > 1
    || view.devices.filter((device) => device.status === "bound").length > 2
    || view.devices.some((device) => (device.status === "removed" && (device.role !== "none" || device.currentDevice))
      || (device.currentDevice && device.role === "none")
      || (device.lastSeenAt !== null && device.lastSeenAt.slice(14) !== "00:00Z"))) {
    context.addIssue({ code: "custom", message: "inconsistent device directory" });
  }
});

export const deviceSelfNameIntentSchema = z.object({ schemaVersion: z.literal(1), displayName: displayLabel }).strict();
export type DeviceDirectoryView = z.infer<typeof deviceDirectoryViewSchema>;
export type DeviceSelfNameIntent = z.infer<typeof deviceSelfNameIntentSchema>;
export interface DeviceDirectorySettingsPort {
  read(): Promise<DeviceDirectoryView>;
  reportSelf(intent: DeviceSelfNameIntent): Promise<DeviceDirectoryView>;
}

export function parseDeviceDirectoryView(value: unknown): DeviceDirectoryView {
  const parsed = deviceDirectoryViewSchema.safeParse(copyPlainData(value));
  if (!parsed.success) throw new TypeError("invalid device directory projection");
  return parsed.data;
}
