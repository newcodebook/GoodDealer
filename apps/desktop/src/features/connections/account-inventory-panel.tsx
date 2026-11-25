import type { AliyunRegistrarPort, AliyunRegistrarStatus, GoDaddyRegistrarPort, GoDaddyRegistrarStatus, PorkbunRegistrarIntent, PorkbunRegistrarPort, PorkbunRegistrarStatus, AtomMarketplacePort, AtomMarketplaceStatus, SedoMarketplacePort, SedoMarketplaceStatus, CloudflareRegistrarAccountPort, CloudflareRegistrarAccountStatus, SellerHubStatus, SellerHubPort, SpaceshipRegistrarIntent, SpaceshipRegistrarPort, SpaceshipRegistrarStatus } from "@gooddealer/client-core";
import { formatDate, formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge, Button, Input, Panel } from "@gooddealer/ui";
import { useEffect, useRef, useState } from "react";

type InventoryPanelProps<P> = {
  readonly locale: Locale;
  readonly port: P;
  readonly writable: boolean;
  readonly onChanged: () => void;
};

export function SpaceshipRegistrarPanel(props: InventoryPanelProps<SpaceshipRegistrarPort>) {
  return <AccountInventoryPanel provider="spaceship" {...props} />;
}

export function SellerHubPanel(props: InventoryPanelProps<SellerHubPort>) {
  return <AccountInventoryPanel provider="sellerhub" {...props} />;
}

export function AliyunRegistrarPanel(props: InventoryPanelProps<AliyunRegistrarPort>) {
  return <AccountInventoryPanel provider="aliyun" {...props} />;
}

export function GoDaddyRegistrarPanel(props: InventoryPanelProps<GoDaddyRegistrarPort>) {
  return <AccountInventoryPanel provider="godaddy" {...props} />;
}

export function PorkbunRegistrarPanel(props: InventoryPanelProps<PorkbunRegistrarPort>) {
  return <AccountInventoryPanel provider="porkbun" {...props} />;
}

export function AtomMarketplacePanel(props: InventoryPanelProps<AtomMarketplacePort>) {
  return <AccountInventoryPanel provider="atom" {...props} />;
}

export function SedoMarketplacePanel(props: InventoryPanelProps<SedoMarketplacePort>) {
  return <AccountInventoryPanel provider="sedo" {...props} />;
}

export function CloudflareRegistrarAccountPanel(props: InventoryPanelProps<CloudflareRegistrarAccountPort>) {
  return <AccountInventoryPanel provider="cloudflare_registrar_account" {...props} />;
}

function AccountInventoryPanel({ provider, locale, port, writable, onChanged }:
  InventoryPanelProps<SpaceshipRegistrarPort | SellerHubPort | AliyunRegistrarPort | GoDaddyRegistrarPort | PorkbunRegistrarPort | AtomMarketplacePort | SedoMarketplacePort | CloudflareRegistrarAccountPort> & {
    readonly provider: "spaceship" | "sellerhub" | "aliyun" | "godaddy" | "porkbun" | "atom" | "sedo" | "cloudflare_registrar_account";
  }) {
  const copy = getPresentationCopy(locale, "settings");
  const providerName = { spaceship: "Spaceship", sellerhub: "SellerHub", aliyun: copy.aliyunRegistrarName, godaddy: "GoDaddy", porkbun: "Porkbun", atom: "Atom", sedo: "Sedo", cloudflare_registrar_account: "Cloudflare Registrar" }[provider];
  const copyPrefix = { spaceship: "spaceshipRegistrar", sellerhub: "sellerHub", aliyun: "aliyunRegistrar", godaddy: "godaddyRegistrar", porkbun: "porkbunRegistrar", atom: "atomMarketplace", sedo: "sedoMarketplace", cloudflare_registrar_account: "cloudflareRegistrarAccount" } as const;
  const prefix = copyPrefix[provider];
  const refresh = provider === "sellerhub" ? copy.sellerHubRefresh
    : provider === "atom" ? copy.atomMarketplaceRefresh
      : provider === "sedo" ? copy.sedoMarketplaceRefresh : copy.spaceshipRegistrarRefresh;
  const [view, setView] = useState<SpaceshipRegistrarStatus | SellerHubStatus | AliyunRegistrarStatus | GoDaddyRegistrarStatus | PorkbunRegistrarStatus | AtomMarketplaceStatus | SedoMarketplaceStatus | CloudflareRegistrarAccountStatus | null>(null);
  const [retry, setRetry] = useState(0);
  const [readFailed, setReadFailed] = useState(false);
  const [submission, setSubmission] = useState<"pending" | "failed" | null>(null);
  const [dnsDomains, setDnsDomains] = useState<Readonly<Record<string, string>>>({});
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
  // A Spaceship connect may enable SellerHub alone, so it does not wait for Registrar observation.
  const canConnect = view !== null && "connectAvailable" in view
    ? writable && ready && view.connectAvailable
    : canScan;
  const states = {
    prepared: copy.spaceshipRegistrarPrepared,
    active: copy.spaceshipRegistrarActive,
    revoked: copy.spaceshipRegistrarRevoked,
  };
  const outcomes = {
    confirmed: view?.lastOperation?.kind === `${provider}_revoke` ? null : copy[`${prefix}Imported`],
    unqualified: copy[`${prefix}Qualification`],
    unreachable: copy[`${prefix}TryLater`],
    retry_later: copy[`${prefix}TryLater`],
    credential_rejected: copy[`${prefix}Permission`],
    credential_store_unavailable: copy.spaceshipRegistrarCustody,
    local_operation_blocked: copy.spaceshipRegistrarFailed,
    provider_response_rejected: copy[`${prefix}InvalidResponse`],
    capture_incomplete: copy.spaceshipRegistrarCapture,
    failed: copy.spaceshipRegistrarFailed,
  };
  // Porkbun Zone record reads share the connection but report their own outcomes.
  const dnsOutcomes: Partial<Record<string, string>> = {
    confirmed: copy.porkbunDnsConfirmed,
    answered_elsewhere: copy.porkbunDnsAnsweredElsewhere,
    api_access_disabled: copy.porkbunDnsApiAccessDisabled,
    not_in_account: copy.porkbunDnsNotInAccount,
    domain_not_active: copy.porkbunDnsDomainNotActive,
    unqualified: copy.porkbunDnsQualification,
    local_operation_blocked: copy.porkbunDnsBlocked,
    provider_response_rejected: copy.porkbunDnsInvalidResponse,
  };
  // Registry delegation reads run under the inventory's qualification and report their own outcomes.
  const delegationOutcomes: Partial<Record<string, string>> = {
    confirmed: copy.porkbunDelegationConfirmed,
    api_access_disabled: copy.porkbunDnsApiAccessDisabled,
    not_in_account: copy.porkbunDnsNotInAccount,
    domain_not_active: copy.porkbunDnsDomainNotActive,
    local_operation_blocked: copy.porkbunDelegationBlocked,
    provider_response_rejected: copy.porkbunDelegationInvalidResponse,
  };
  const lastOperation = view?.lastOperation ?? null;
  const message = readFailed ? copy[`${prefix}Unavailable`]
    : submission === "failed" ? copy.spaceshipRegistrarFailed
    : (busy || lastOperation === null) ? null
    : lastOperation.kind === "porkbun_dns_observe"
      ? dnsOutcomes[lastOperation.outcome] ?? outcomes[lastOperation.outcome as keyof typeof outcomes]
      : lastOperation.kind === "porkbun_delegation_observe"
        ? delegationOutcomes[lastOperation.outcome] ?? outcomes[lastOperation.outcome as keyof typeof outcomes]
        : outcomes[lastOperation.outcome as keyof typeof outcomes];
  const dns = view !== null && "dnsObserve" in view ? view.dnsObserve : null;
  const canReadDns = writable && ready && dns !== null && dns.qualified && dns.entitled;

  const submit = (intent: SpaceshipRegistrarIntent | PorkbunRegistrarIntent) => {
    if (!writable || pending.current) return;
    pending.current = true;
    setSubmission("pending");
    const ticket = generation.current;
    // Only a Porkbun status carries `dnsObserve`, so only the Porkbun port receives a per-domain read.
    // SellerHub has no connect of its own: its panel never offers one and its port refuses it.
    const sent = intent.action === "observe-dns" || intent.action === "observe-delegation"
      ? (port as PorkbunRegistrarPort).submit(intent)
      : (port as SpaceshipRegistrarPort).submit(intent);
    void sent.then(() => {
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

  return <Panel title={copy[`${prefix}Title`]}
    actions={<Button type="button" size="sm" disabled={submission === "pending"} onClick={() => setRetry((value) => value + 1)}>{copy.afternicRefreshStatus}</Button>}>
    <p>{copy[`${prefix}Help`]}</p>
    {writable && view !== null && !view.observeEntitled ? <p>{copy[`${prefix}Entitlement`]}</p> : null}
    {writable && view !== null && (!view.observeQualified || !view.capturable) ? <p>{copy[`${prefix}Qualification`]}</p> : null}
    {writable && dns !== null && !dns.entitled ? <p>{copy.porkbunDnsEntitlement}</p> : null}
    {writable && dns !== null && !dns.qualified ? <p>{copy.porkbunDnsQualification}</p> : null}
    {busy ? <p>{copy[`${prefix}Working`]}</p> : null}
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
            {connection.state === "active" && scan !== null && "standardReview" in scan
              ? <AtomStandardInventory review={scan.standardReview} locale={locale} />
              : null}
          </div>
          {writable ? <div>
            {connection.state === "revoked" || (provider === "cloudflare_registrar_account" && connection.state === "prepared") ? null : <Button type="button" size="sm" disabled={!canScan}
              aria-label={`${refresh} ${name}`}
              onClick={() => submit({ schemaVersion: 1, action: "refresh", connectionId: connection.connectionId })}>{refresh}</Button>}
            <Button type="button" size="sm" disabled={readFailed || busy || view.laneState === "blocked"}
              aria-label={`${revokeLabel} ${name}`}
              onClick={() => submit({ schemaVersion: 1, action: "revoke", connectionId: connection.connectionId })}>{revokeLabel}</Button>
            {dns === null || connection.state !== "active" ? null : <>
              <Input size="sm" mono label={copy.porkbunDnsDomain} placeholder="example.com"
                value={dnsDomains[connection.connectionId] ?? ""}
                disabled={!canReadDns && !canScan}
                onChange={(event) => { const next = event.currentTarget.value; setDnsDomains((current) => ({ ...current, [connection.connectionId]: next })); }} />
              <Button type="button" size="sm"
                disabled={!canReadDns || (dnsDomains[connection.connectionId] ?? "").trim() === ""}
                aria-label={`${copy.porkbunDnsRead} ${name}`}
                onClick={() => submit({ schemaVersion: 1, action: "observe-dns", connectionId: connection.connectionId,
                  domain: (dnsDomains[connection.connectionId] ?? "").trim().toLowerCase() })}>{copy.porkbunDnsRead}</Button>
              <Button type="button" size="sm"
                disabled={!canScan || (dnsDomains[connection.connectionId] ?? "").trim() === ""}
                aria-label={`${copy.porkbunDelegationRead} ${name}`}
                onClick={() => submit({ schemaVersion: 1, action: "observe-delegation", connectionId: connection.connectionId,
                  domain: (dnsDomains[connection.connectionId] ?? "").trim().toLowerCase() })}>{copy.porkbunDelegationRead}</Button>
            </>}
          </div> : null}
        </li>;
      })}
    </ul> : null}
    {/* SellerHub is a role of the Spaceship connection, so only Spaceship offers a connect. */}
    {writable && provider !== "sellerhub" ? <Button type="button" disabled={!canConnect || !view?.capturable}
      onClick={() => submit({ schemaVersion: 1, action: "connect" })}>{copy[`${copyPrefix[provider]}Connect`]}</Button> : null}
  </Panel>;
}

function AtomStandardInventory({ review, locale }: {
  readonly review: NonNullable<AtomMarketplaceStatus["connections"][number]["lastScan"]>["standardReview"];
  readonly locale: Locale;
}) {
  const copy = getPresentationCopy(locale, "settings");
  if (review === null) return <p>{copy.atomStandardUnavailable}</p>;
  return <>
    <p>{copy.atomStandardCount.replace("{count}", formatNumber(locale, review.observed))}</p>
    {review.sample.length > 0 ? <details>
      <summary>{copy.atomStandardSample.replace("{count}", formatNumber(locale, review.sample.length))}</summary>
      <ul>{review.sample.map((domain) => <li key={domain}>{domain}</li>)}</ul>
    </details> : null}
  </>;
}
