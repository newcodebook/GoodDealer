import type { AliyunRegistrarPort, AliyunRegistrarStatus, SpaceshipRegistrarIntent, SpaceshipRegistrarPort, SpaceshipRegistrarStatus } from "@gooddealer/client-core";
import { formatDate, formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge, Button, Panel } from "@gooddealer/ui";
import { useEffect, useRef, useState } from "react";

type RegistrarPanelProps<P> = {
  readonly locale: Locale;
  readonly port: P;
  readonly writable: boolean;
  readonly onChanged: () => void;
};

export function SpaceshipRegistrarPanel(props: RegistrarPanelProps<SpaceshipRegistrarPort>) {
  return <AccountRegistrarPanel provider="spaceship" {...props} />;
}

export function AliyunRegistrarPanel(props: RegistrarPanelProps<AliyunRegistrarPort>) {
  return <AccountRegistrarPanel provider="aliyun" {...props} />;
}

function AccountRegistrarPanel({ provider, locale, port, writable, onChanged }:
  RegistrarPanelProps<SpaceshipRegistrarPort | AliyunRegistrarPort> & {
    readonly provider: "spaceship" | "aliyun";
  }) {
  const copy = getPresentationCopy(locale, "settings");
  const providerName = provider === "aliyun" ? copy.aliyunRegistrarName : "Spaceship";
  const [view, setView] = useState<SpaceshipRegistrarStatus | AliyunRegistrarStatus | null>(null);
  const [retry, setRetry] = useState(0);
  const [readFailed, setReadFailed] = useState(false);
  const [submission, setSubmission] = useState<"pending" | "failed" | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  const previous = useRef<string | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => {
    const ticket = ++generation.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const next = await port.status();
        if (ticket !== generation.current) return;
        setView(next);
        setReadFailed(false);
        const snapshot = JSON.stringify(next.connections);
        if (previous.current !== null && previous.current !== snapshot) changed.current();
        previous.current = snapshot;
        if (next.laneState === "busy" || next.laneState === "recovering") {
          timer = setTimeout(() => { void read(); }, 1000);
        }
      } catch {
        if (ticket === generation.current) setReadFailed(true);
      }
    };
    void read();
    return () => { generation.current += 1; clearTimeout(timer); };
  }, [port, retry]);

  const ready = view?.laneState === "ready" && !readFailed && submission !== "pending";
  const canScan = writable && ready && view.observeQualified && view.observeEntitled;
  const busy = submission === "pending" || view?.laneState === "busy";
  const states = {
    prepared: copy.spaceshipRegistrarPrepared,
    active: copy.spaceshipRegistrarActive,
    revoked: copy.spaceshipRegistrarRevoked,
  };
  const outcomes = {
    confirmed: view?.lastOperation?.kind === `${provider}_revoke` ? null : copy[`${provider}RegistrarImported`],
    unqualified: copy[`${provider}RegistrarQualification`],
    unreachable: copy[`${provider}RegistrarTryLater`],
    retry_later: copy[`${provider}RegistrarTryLater`],
    credential_rejected: copy[`${provider}RegistrarPermission`],
    credential_store_unavailable: copy.spaceshipRegistrarCustody,
    local_operation_blocked: copy.spaceshipRegistrarFailed,
    provider_response_rejected: copy[`${provider}RegistrarInvalidResponse`],
    capture_incomplete: copy.spaceshipRegistrarCapture,
    failed: copy.spaceshipRegistrarFailed,
  };
  const message = readFailed ? copy[`${provider}RegistrarUnavailable`]
    : submission === "failed" ? copy.spaceshipRegistrarFailed
    : (!busy && view?.lastOperation != null) ? outcomes[view.lastOperation.outcome] : null;

  const submit = (intent: SpaceshipRegistrarIntent) => {
    if (!writable || pending.current) return;
    pending.current = true;
    setSubmission("pending");
    const ticket = generation.current;
    void port.submit(intent).then(() => {
      if (ticket === generation.current) {
        setView((current) => current === null ? current : { ...current, laneState: "busy" });
        setSubmission(null);
      }
    }, () => {
      if (ticket === generation.current) setSubmission("failed");
    }).finally(() => {
      pending.current = false;
      if (ticket === generation.current) setRetry((value) => value + 1);
    });
  };

  return <Panel title={copy[`${provider}RegistrarTitle`]}
    actions={<Button type="button" size="sm" disabled={submission === "pending"} onClick={() => setRetry((value) => value + 1)}>{copy.afternicRefreshStatus}</Button>}>
    <p>{copy[`${provider}RegistrarHelp`]}</p>
    {writable && view !== null && !view.observeEntitled ? <p>{copy[`${provider}RegistrarEntitlement`]}</p> : null}
    {writable && view !== null && (!view.observeQualified || !view.capturable) ? <p>{copy[`${provider}RegistrarQualification`]}</p> : null}
    {busy ? <p>{copy[`${provider}RegistrarWorking`]}</p> : null}
    <p role="status">{message}</p>
    {view?.connections.length ? <ul className="settings-device-directory" role="list">
      {view.connections.map((connection) => {
        const name = view.connections.length === 1 ? providerName : `${providerName} · ${connection.connectionId.slice(0, 8)}`;
        const scan = connection.lastScan;
        const summary = scan === null ? copy.spaceshipRegistrarNeverScanned : copy.spaceshipRegistrarCounts
          .replace("{observed}", formatNumber(locale, scan.observed))
          .replace("{imported}", formatNumber(locale, scan.imported))
          .replace("{skipped}", formatNumber(locale, scan.skipped));
        const revokeLabel = connection.state === "revoked" ? copy.spaceshipRegistrarCleanup : copy.spaceshipRegistrarDisconnect;
        return <li key={connection.connectionId} className="settings-device-row">
          <div><strong>{name}</strong> <Badge>{states[connection.state]}</Badge>
            <p>{summary}</p>
            {scan === null ? null : <p>{formatDate(locale, Date.parse(scan.completedAt), { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</p>}
          </div>
          {writable ? <div>
            {connection.state === "revoked" ? null : <Button type="button" size="sm" disabled={!canScan}
              aria-label={`${copy.spaceshipRegistrarRefresh} ${name}`}
              onClick={() => submit({ schemaVersion: 1, action: "refresh", connectionId: connection.connectionId })}>{copy.spaceshipRegistrarRefresh}</Button>}
            <Button type="button" size="sm" disabled={readFailed || busy || view.laneState === "blocked"}
              aria-label={`${revokeLabel} ${name}`}
              onClick={() => submit({ schemaVersion: 1, action: "revoke", connectionId: connection.connectionId })}>{revokeLabel}</Button>
          </div> : null}
        </li>;
      })}
    </ul> : null}
    {writable ? <Button type="button" disabled={!canScan || !view?.capturable}
      onClick={() => submit({ schemaVersion: 1, action: "connect" })}>{copy[`${provider}RegistrarConnect`]}</Button> : null}
  </Panel>;
}
