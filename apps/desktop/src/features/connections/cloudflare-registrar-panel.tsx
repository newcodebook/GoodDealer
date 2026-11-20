import { formatDate, formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Button, Panel } from "@gooddealer/ui";
import { useEffect, useRef, useState } from "react";
import type { CloudflareConnectionStatus, CloudflarePort } from "../../adapters/tauri";

export function CloudflareRegistrarPanel({ locale, port, writable, onChanged }: {
  readonly locale: Locale;
  readonly port: Pick<CloudflarePort, "status" | "refreshRegistrar">;
  readonly writable: boolean;
  readonly onChanged: () => void;
}) {
  const copy = getPresentationCopy(locale, "settings");
  const [status, setStatus] = useState<CloudflareConnectionStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<"unknown" | "unavailable" | null>(null);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const currentScan = useRef<string | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => {
    const ticket = ++generation.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const next = await port.status();
        if (ticket !== generation.current) return;
        setStatus(next);
        setNotice((current) => current === "unavailable" ? null : current);
        const scanTime = next.registrar?.lastScan?.completedAt ?? null;
        if (scanTime !== currentScan.current) {
          currentScan.current = scanTime;
          if (scanTime !== null) {
            setNotice(null);
            changed.current();
          }
        }
        if (next.state === "busy" || next.state === "recovering") {
          timer = setTimeout(() => { void read(); }, 1000);
        }
      } catch {
        if (ticket === generation.current) setNotice("unavailable");
      }
    };
    void read();
    return () => { generation.current += 1; clearTimeout(timer); };
  }, [port, refresh]);

  const registrar = status?.registrar;
  if (notice === "unavailable") {
    return <Panel title={copy.cloudflareRegistrarTitle}
      actions={<Button type="button" size="sm" onClick={() => setRefresh((value) => value + 1)}>{copy.retryRead}</Button>}>
      <p role="status">{copy.cloudflareRegistrarUnavailable}</p>
    </Panel>;
  }
  if (registrar == null) return null;
  const canRefresh = writable && !submitting && status?.state === "ready" && status.connectionRef !== null;
  const scan = registrar.lastScan;
  const errors = {
    unqualified: copy.cloudflareRegistrarUnavailable,
    unreachable: copy.cloudflareProviderUnreachable,
    retry_later: copy.cloudflareProviderRetryLater,
    credential_rejected: copy.cloudflareRegistrarPermission,
    provider_response_rejected: copy.cloudflareRegistrarFailed,
    failed: copy.cloudflareRegistrarFailed,
  };
  const last = registrar.lastOutcome;
  const message = notice === "unknown" ? copy.cloudflareRegistrarFailed
    : status?.state === "ready" && last !== null && last !== "confirmed" ? errors[last] : null;
  const summary = scan === null ? copy.cloudflareRegistrarNeverScanned
    : copy.cloudflareRegistrarCounts
      .replace("{observed}", formatNumber(locale, scan.observed))
      .replace("{imported}", formatNumber(locale, scan.imported))
      .replace("{skipped}", formatNumber(locale, scan.skipped));
  const submit = () => {
    if (!canRefresh || status.connectionRef === null) return;
    setSubmitting(true);
    setNotice(null);
    const ticket = generation.current;
    void port.refreshRegistrar(status.connectionRef).then(() => {
      if (ticket === generation.current) setStatus({ ...status, state: "busy" });
    }, () => {
      if (ticket === generation.current) setNotice("unknown");
    }).finally(() => {
      if (ticket !== generation.current) return;
      setSubmitting(false);
      setRefresh((value) => value + 1);
    });
  };

  return <Panel title={copy.cloudflareRegistrarTitle}
    actions={<Button type="button" size="sm" disabled={!canRefresh} onClick={submit}>{copy.cloudflareRegistrarRefresh}</Button>}>
    <p>{copy.cloudflareRegistrarHelp}</p>
    {status?.state === "busy" ? <p>{copy.cloudflareRegistrarScanning}</p> : null}
    <p role="status">{message ?? summary}</p>
    {message !== null && scan !== null ? <p>{summary}</p> : null}
    {scan === null ? null : <p>{formatDate(locale, Date.parse(scan.completedAt), { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</p>}
  </Panel>;
}
