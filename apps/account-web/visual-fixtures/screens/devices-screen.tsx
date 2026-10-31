import type { Locale } from "@gooddealer/i18n";
import { useState } from "react";

import { AccountDevices, type AccountDeviceView } from "../../src/features/devices/account-devices";
import { FixtureShell } from "./fixture-shell";

export const devicesVariants = [
  { id: "full", label: "额度已满" },
  { id: "single", label: "单台设备" },
  { id: "empty", label: "尚无设备" },
] as const;

type DevicesVariant = (typeof devicesVariants)[number]["id"];

const workstation: AccountDeviceView = {
  deviceId: "dev_fixture_workstation",
  displayName: "Studio Workstation",
  platform: "Linux · x86_64",
  state: "active",
  leaseEpoch: 41,
  boundAt: "2025-12-31T02:00:00.000Z",
  lastSeenAt: "2026-10-31T08:58:00.000Z",
};
const laptop: AccountDeviceView = {
  deviceId: "dev_fixture_laptop",
  displayName: "MacBook Pro",
  platform: "macOS · Apple Silicon",
  state: "standby",
  leaseEpoch: null,
  boundAt: "2026-06-02T10:00:00.000Z",
  lastSeenAt: "2026-10-30T23:30:00.000Z",
};

const fixtures: Record<DevicesVariant, readonly AccountDeviceView[]> = {
  full: [workstation, laptop],
  single: [workstation],
  empty: [],
};

/** Mock device list; Account Web has no device route yet, so removal settles locally. */
export function DevicesScreen({ variant, locale }: { readonly variant: string; readonly locale: Locale }) {
  const [devices, setDevices] = useState(fixtures[(variant in fixtures ? variant : "full") as DevicesVariant]);
  const [busy, setBusy] = useState(false);
  return (
    <FixtureShell locale={locale} routeId="devices">
      <AccountDevices
        locale={locale}
        timeZone="UTC"
        devices={devices}
        deviceLimit={2}
        busy={busy}
        onRemove={(deviceId) => {
          setBusy(true);
          setTimeout(() => { setBusy(false); setDevices((current) => current.filter((device) => device.deviceId !== deviceId)); }, 700);
        }}
        onOpenDownload={() => undefined}
      />
    </FixtureShell>
  );
}
