import type { DeviceDirectorySettingsPort } from "@gooddealer/client-core";
import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Button } from "@gooddealer/ui";
import { NativeWindow, type ShellWindowFrame } from "../app-shell";
import { DeviceDirectoryPanel } from "../features/settings";
import "../features/runtime-mode/runtime-status/runtime-status-page.css";

/** A bound device without a replica has directory access, but no business projection to render. */
export function StandbyAwaitingReplica({ locale, windowFrame, port, onRefreshAuthorization }: {
  readonly locale: Locale;
  readonly windowFrame: ShellWindowFrame;
  readonly port: DeviceDirectorySettingsPort;
  readonly onRefreshAuthorization: () => void;
}) {
  const copy = getPresentationCopy(locale, "shell");
  return <div className="runtime-status-window">
    <NativeWindow locale={locale} windowFrame={windowFrame} context={copy.standbyAwaitingTitle}>
      <main className="runtime-status" data-runtime-status="standby_awaiting_replica">
        <div className="runtime-status-card">
          <h1 className="runtime-status-title">{copy.standbyAwaitingTitle}</h1>
          <p className="gd-t-body-2">{copy.standbyAwaitingDescription}</p>
          <Button onClick={onRefreshAuthorization}>{copy.refreshAuthorization}</Button>
          <DeviceDirectoryPanel locale={locale} port={port} readOnly />
        </div>
      </main>
    </NativeWindow>
  </div>;
}
