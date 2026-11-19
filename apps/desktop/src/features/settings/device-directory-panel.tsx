import { deviceSelfNameIntentSchema, type DeviceDirectorySettingsPort, type DeviceDirectoryView } from "@gooddealer/client-core";
import { formatDate, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge, Banner, Button, Input, Panel } from "@gooddealer/ui";
import { useEffect, useId, useRef, useState } from "react";

import type { DeviceSwitchPort, TargetBootstrapPort, TargetInstallationPort, ForcedTakeoverPort } from "../../adapters/tauri";
import { ForcedTakeoverPanel } from "./forced-takeover-panel";
import { TargetBootstrapPanel } from "./target-bootstrap-panel";
import { DeviceHandoffPanel } from "./device-handoff-panel";

const platformLabels = { windows: "Windows", macos: "macOS", linux: "Linux", ios: "iOS", android: "Android" } as const;

type DirectoryState = { readonly kind: "loading" | "failed" | "unknown" }
  | { readonly kind: "ready" | "saving"; readonly view: DeviceDirectoryView; readonly saved: boolean };

/** Directory metadata offers candidates; every handoff still crosses the separate Native gate. */
export function DeviceDirectoryPanel({ locale, port, switchPort, bootstrapPort, installationPort, forcedTakeoverPort, readOnly = false }: { readonly locale: Locale; readonly port: DeviceDirectorySettingsPort; readonly switchPort?: DeviceSwitchPort; readonly bootstrapPort?: TargetBootstrapPort; readonly installationPort?: TargetInstallationPort; readonly forcedTakeoverPort?: ForcedTakeoverPort; readonly readOnly?: boolean }) {
  const copy = getPresentationCopy(locale, "settings");
  const [state, setState] = useState<DirectoryState>({ kind: "loading" });
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  const inputId = useId();
  useEffect(() => {
    const ticket = ++request.current;
    setState({ kind: "loading" });
    setInvalid(false);
    void port.read().then((view) => {
      if (ticket !== request.current) return;
      setName(view.devices.find((device) => device.currentDevice)?.displayName ?? "");
      setState({ kind: "ready", view, saved: false });
    }, () => { if (ticket === request.current) setState({ kind: "failed" }); });
    return () => { request.current += 1; };
  }, [port, attempt]);

  const save = () => {
    if (readOnly || state.kind !== "ready" || !state.view.devices.some((device) => device.currentDevice && device.role === "active")) return;
    const intent = deviceSelfNameIntentSchema.safeParse({ schemaVersion: 1, displayName: name });
    if (!intent.success) { setInvalid(true); document.getElementById(inputId)?.focus(); return; }
    const ticket = ++request.current;
    setState({ ...state, kind: "saving", saved: false });
    void port.reportSelf(intent.data).then((view) => {
      if (ticket !== request.current) return;
      setName(view.devices.find((device) => device.currentDevice)?.displayName ?? "");
      setState({ kind: "ready", view, saved: true });
    }, () => {
      // A timeout may follow a committed report. Read the persisted name before offering another save.
      if (ticket === request.current) setState({ kind: "unknown" });
    });
  };
  const ready = state.kind === "ready" || state.kind === "saving";
  return <Panel title={copy.deviceExecutionTitle} actions={<Button size="sm" disabled={state.kind === "saving" || state.kind === "loading"} onClick={() => setAttempt((value) => value + 1)}>{copy.refreshDevices}</Button>}>
    {state.kind === "loading" ? <p>{copy.devicesLoading}</p> : null}
    {state.kind === "failed" || state.kind === "unknown" ? <Banner tone="warning" title={state.kind === "unknown" ? copy.deviceSaveUnknown : copy.devicesUnavailable} /> : null}
    {bootstrapPort === undefined ? null : <TargetBootstrapPanel locale={locale} port={bootstrapPort} {...(installationPort === undefined ? {} : { installationPort })} />}
    {forcedTakeoverPort === undefined ? null : <ForcedTakeoverPanel locale={locale} port={forcedTakeoverPort} eligible={ready && state.view.devices.some(device => device.currentDevice && device.status === "bound" && device.role === "standby")} />}
    {ready ? <>
      <ul className="settings-device-directory" role="list">
        {state.view.devices.map((device) => <li key={device.deviceId} className="settings-device-row">
          <div>
            <strong>{device.displayName ?? copy.unnamedDevice}</strong> {device.currentDevice ? <Badge>{copy.thisDevice}</Badge> : null}
            <p className="gd-t-meta">{device.platform === null ? copy.unknownPlatform : platformLabels[device.platform]} · {device.deviceId.slice(-8)}</p>
            <p className="gd-t-meta">{copy.deviceLastReported}: {device.lastSeenAt === null ? copy.neverReported : formatDate(locale, Date.parse(device.lastSeenAt), { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC"}</p>
          </div>
          <Badge>{device.status === "removed" ? copy.deviceRemoved : device.role === "active" ? copy.deviceActive : device.role === "standby" ? copy.deviceStandby : copy.deviceNotAuthorized}</Badge>
        </li>)}
      </ul>
      {switchPort === undefined ? null : <DeviceHandoffPanel locale={locale} port={switchPort} directory={state.view} readOnly={readOnly} />}
      {!readOnly && state.view.devices.some((device) => device.currentDevice && device.role === "active") ? <form aria-label={copy.deviceName} onSubmit={(event) => { event.preventDefault(); save(); }}>
        <label htmlFor={inputId}>{copy.deviceName}</label>
        <p id={`${inputId}-help`} className="gd-t-meta">{copy.deviceNameHelp}</p>
        {/* HTML counts UTF-16 units; the strict schema below counts at most 64 Unicode code points. */}
        <Input id={inputId} name="displayName" required maxLength={128} value={name} disabled={state.kind === "saving"}
          aria-invalid={invalid || undefined} aria-describedby={`${inputId}-help${invalid ? ` ${inputId}-error` : ""}`}
          onChange={(event) => { setName(event.currentTarget.value); setInvalid(false); }} />
        {invalid ? <p id={`${inputId}-error`} role="alert">{copy.deviceNameInvalid}</p> : null}
        <Button type="submit" disabled={state.kind === "saving"}>{state.kind === "saving" ? copy.deviceSaving : copy.saveDeviceName}</Button>
        <p role="status">{state.saved ? copy.deviceSaved : ""}</p>
      </form> : null}
    </> : null}
  </Panel>;
}
