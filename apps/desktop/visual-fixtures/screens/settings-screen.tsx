import { defaultLocale, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Banner } from "@gooddealer/ui";
import { useEffect, useState } from "react";

import { SettingsPanel, type SettingsSection } from "../../src/features/settings";
import { MockShell, mockShellStatus } from "../mock/mock-shell";
import {
  initialMockDevices,
  mockAbout,
  mockConnectionSettings,
  mockHandoffPhase,
  mockLicense,
  mockSyncSettings,
} from "../mock/settings-fixtures";
import type { DesignWindowPlatform } from "../screen-registry";

export const settingsVariants = [
  { id: "devices", label: "设备与运行态" },
  { id: "connections", label: "连接" },
  { id: "license", label: "许可" },
  { id: "sync", label: "同步偏好" },
  { id: "about", label: "关于" },
  { id: "standby", label: "Standby · 只读" },
] as const;

/** Settings with a simulated lease handoff: drain, secure activation, then a new epoch. */
export function SettingsScreen({ variant, platform, onNavigateScreen }: {
  readonly variant: string;
  readonly platform: DesignWindowPlatform;
  readonly onNavigateScreen: (id: string) => void;
}) {
  const standbyVariant = variant === "standby";
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  const [devices, setDevices] = useState(() => initialMockDevices(standbyVariant));
  const [handoff, setHandoff] = useState<string | null>(null);
  const [cadence, setCadence] = useState<"when_visible" | "every_5_minutes" | "every_15_minutes">("every_5_minutes");
  const shellCopy = getPresentationCopy(locale, "shell");
  const standby = devices.devices.some((device) => device.self && device.state === "standby");

  useEffect(() => {
    if (handoff === null) return undefined;
    const timer = setTimeout(() => { setDevices((current) => mockHandoffPhase(current, handoff, "complete")); setHandoff(null); }, 1600);
    return () => clearTimeout(timer);
  }, [handoff]);

  return (
    <MockShell
      locale={locale}
      platform={platform}
      activeNavigationId="settings"
      title={getPresentationCopy(locale, "settings").title}
      status={mockShellStatus(0, handoff !== null, standby)}
      onNavigateScreen={onNavigateScreen}
      {...(standby ? { banner: <Banner tone="sync" title={shellCopy.standby}>{shellCopy.standbyNotice}</Banner> } : {})}
    >
      <SettingsPanel
        key={variant}
        locale={locale}
        initialSection={(standbyVariant ? "connections" : variant) as SettingsSection}
        connections={mockConnectionSettings(standby)}
        onConnectionAction={() => undefined}
        onAddConnection={() => undefined}
        onRunOnboarding={() => onNavigateScreen("onboarding")}
        devices={devices}
        onHandoff={(deviceId) => { setDevices((current) => mockHandoffPhase(current, deviceId, "draining")); setHandoff(deviceId); }}
        license={mockLicense}
        onManageSubscription={() => undefined}
        onRenew={() => undefined}
        sync={mockSyncSettings(cadence)}
        onPullRefreshChange={setCadence}
        about={mockAbout}
        onLocaleChange={setLocale}
      />
    </MockShell>
  );
}
