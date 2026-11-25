import type { TargetBootstrapPort, TargetInstallationPort, ForcedTakeoverPort } from "../adapters/tauri";
import type { DeviceDirectorySettingsPort } from "@gooddealer/client-core";
import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Button } from "@gooddealer/ui";
import { NativeWindow, type ShellWindowFrame } from "../app-shell";
import { DeviceDirectoryPanel } from "../features/settings";
import "../features/runtime-mode/runtime-status/runtime-status-page.css";

interface AwaitingReplicaProps {
  readonly locale: Locale;
  readonly windowFrame: ShellWindowFrame;
  readonly port: DeviceDirectorySettingsPort;
  readonly bootstrapPort?: TargetBootstrapPort;
  readonly installationPort?: TargetInstallationPort;
  readonly forcedTakeoverPort?: ForcedTakeoverPort;
  readonly onRefreshAuthorization: () => void;
}

/** A bound Standby has directory access, but no business projection to render. */
export function StandbyAwaitingReplica(props: AwaitingReplicaProps) {
  return <AwaitingReplica {...props} installationPending={false} />;
}
/** A signed identity may reconcile activation without publishing any business read authority. */
export function TargetInstallationPending(props: AwaitingReplicaProps) {
  return <AwaitingReplica {...props} installationPending />;
}
function AwaitingReplica({ locale, windowFrame, port, bootstrapPort, installationPort, forcedTakeoverPort, onRefreshAuthorization, installationPending }: AwaitingReplicaProps & { readonly installationPending: boolean }) {
  const copy = getPresentationCopy(locale, "shell");
  const title = installationPending ? copy.installationPendingTitle : copy.standbyAwaitingTitle;
  const description = installationPending ? copy.installationPendingDescription : copy.standbyAwaitingDescription;
  return <div className="runtime-status-window">
    <NativeWindow locale={locale} windowFrame={windowFrame} context={title}>
      <main className="runtime-status" data-runtime-status={installationPending ? "target_installation_pending" : "standby_awaiting_replica"}>
        <div className="runtime-status-card">
          <h1 className="runtime-status-title">{title}</h1>
          <p className="gd-t-body-2">{description}</p>
          <Button onClick={onRefreshAuthorization}>{copy.refreshAuthorization}</Button>
          <DeviceDirectoryPanel locale={locale} port={port} {...(bootstrapPort === undefined ? {} : { bootstrapPort })} {...(installationPort === undefined ? {} : { installationPort })} {...(forcedTakeoverPort === undefined ? {} : { forcedTakeoverPort })} readOnly />
        </div>
      </main>
    </NativeWindow>
  </div>;
}
