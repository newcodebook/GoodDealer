import {
  projectActivationWizardViewModel,
  type ActivationAction,
  type ActivationWizardViewModel,
  type CanonicalDomainName,
} from "@gooddealer/client-core";
import { formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Button } from "@gooddealer/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LocalDeviceLease } from "../adapters/tauri";
import { NativeWindow, type ShellWindowFrame } from "../app-shell";
import { cloudflareNoticeCopyKey, readCloudflareNotice, settleCloudflareNotice } from "../features/connections";
import { AddDomainDialog, type AddDomainOutcome } from "../features/portfolio";
import { ActivationWizard } from "../features/runtime-mode";
import { addDomainAsset, createPortfolioMutationController } from "./portfolio-controllers";
import {
  readAuthoritativeWorkspacePublication,
  type AuthoritativeWorkspacePorts,
  type AuthoritativeWorkspacePublication,
} from "./workspace-publication";

export type OnboardingStep = ActivationWizardViewModel["step"];
const steps: readonly OnboardingStep[] = ["welcome", "device", "connections", "initial_import", "complete"];

/** Whether the workspace can take the onboarding's writes: Active with the mutate capability. */
export function onboardingWritable(publication: AuthoritativeWorkspacePublication): boolean {
  return publication.status.state === "active" && publication.status.capabilities.includes("workspace:mutate");
}

/**
 * First run is an Active workspace that holds no domain yet. Standby or locked workspaces cannot
 * add domains, and a workspace that already has domains needs no first import, so neither is offered.
 *
 * A returning person on a new device also starts with no local rows until the first pull lands, so
 * the decision waits while sync is still checking or pulling; offering then would invite them to
 * re-add domains they already own. An offline or blocked workspace is not offered onboarding.
 */
export function onboardingOffer(publication: AuthoritativeWorkspacePublication): "wait" | "offer" | "decline" {
  if (!onboardingWritable(publication) || publication.portfolio === null || publication.sync === null) return "decline";
  if (publication.portfolio.totalRows > 0) return "decline";
  const sync = publication.sync;
  if (sync.transport === "checking" || sync.activity === "syncing") return "wait";
  return sync.transport === "reachable" && !sync.recoveryRequired ? "offer" : "decline";
}

/**
 * The wizard view for one step, built only from Host facts and validated by the client-core
 * schema. Null means the facts do not form a valid step, and the caller leaves onboarding.
 *
 * - The device step shows the lease the Host verified; the Host has no device name, so none shows.
 * - Cloudflare's card follows the Host status (`cloudflare` is null until it is read). It is
 *   unavailable unless the capability is qualified (ADR-0024), and admits connecting or
 *   disconnecting only as `cloudflareAdmittedActions` decides; while one runs (`cloudflarePending`)
 *   it is connecting and admits nothing. Connecting imports the zone's domain in the Host, so the
 *   import step has nothing of its own to import from observations: with Cloudflare connected it
 *   says so, otherwise it says nothing is connected.
 * - Completion reports the workspace's domain count and the applied server revision.
 */
export function onboardingView(
  step: OnboardingStep,
  lease: LocalDeviceLease,
  publication: AuthoritativeWorkspacePublication,
  locale: Locale,
  cloudflare: CloudflareRead | null = null,
  cloudflarePending = false,
): ActivationWizardViewModel | null {
  const sync = publication.sync;
  const cardState = cloudflarePending ? "connecting" : cloudflareCardState(cloudflare);
  const admitted = cloudflarePending ? [] : cloudflareAdmittedActions(cloudflare, onboardingWritable(publication));
  const cloudflareConnected = cloudflare?.status?.state === "ready";
  const base = (() => {
    switch (step) {
      case "welcome":
        return { step, availableActions: ["skip", "continue"] };
      case "device":
        return {
          step,
          deviceName: null,
          activationState: "active",
          deviceIdentity: { status: "bound", deviceId: lease.deviceId },
          activeLease: { status: "issued", issuer: "gooddealer_cloud", deviceId: lease.deviceId, leaseEpoch: lease.leaseEpoch },
          availableActions: ["back", "continue"],
        };
      case "connections":
        return {
          step,
          providers: [{ providerId: "cloudflare", displayName: "Cloudflare", metadata: "API Token", category: "dns", connectionState: cardState, admittedActions: admitted }],
          connectedCount: cardState === "connected" ? 1 : 0,
          availableActions: [
            "back",
            ...(admitted.includes("connect") ? ["connect_provider" as const] : []),
            ...(admitted.includes("disconnect") ? ["disconnect_provider" as const] : []),
            "continue",
          ],
        };
      case "initial_import":
        return {
          step,
          connectedCount: cloudflareConnected ? 1 : 0,
          importState: "unavailable",
          progress: 0,
          importedDomains: null,
          importedListings: null,
          conflicts: null,
          baselineServerRevision: null,
          availableActions: ["back", "continue"],
        };
      case "complete":
        return {
          step,
          deviceName: null,
          importedDomains: publication.portfolio?.totalRows ?? 0,
          baselineServerRevision: sync?.appliedThroughServerRevision ?? 0,
          syncReady: sync !== null && sync.transport === "reachable" && !sync.recoveryRequired && sync.blockedReason === null,
          availableActions: ["enter_workspace"],
        };
    }
  })();
  const projected = projectActivationWizardViewModel(base);
  return projected.ok ? projected.value : null;
}

/**
 * The card claims only the credential state. `busy` may be a revoke or an observation, not a
 * connect, so it is shown as unavailable rather than connecting; a failed or unconfirmed operation
 * is shown as failed only while no ready credential exists, because a failed observation leaves a
 * ready credential ready. After a confirmed revoke the card is disconnected again. The meta line
 * carries the operation's own reason either way.
 */
function cloudflareCardState(cloudflare: CloudflareRead | null): "disconnected" | "connected" | "failed" | "unavailable" {
  if (cloudflare === null) return "unavailable";
  const { notice, status } = cloudflare;
  if (notice === "connected") return "connected";
  if (notice === "notConfigured") return "disconnected";
  if (notice === "revoked") return status?.state === "ready" ? "connected" : "disconnected";
  if (notice === "operationFailed" || notice === "operationUnconfirmed" || notice === "zoneUnimportable" || notice === "providerUnreachable"
    || notice === "providerRetryLater" || notice === "credentialRejected") {
    return status?.state === "ready" ? "connected" : "failed";
  }
  return "unavailable";
}

/**
 * What the Cloudflare card may do, decided only from Host facts: the workspace must take writes
 * (Active with mutate, the same gate as every write entry), the Host must report the capability
 * qualified (ADR-0024), and its build must be able to capture a token (macOS only; elsewhere no
 * credential can exist, so there is nothing to revoke either). A running, recovering or blocked
 * operation, or an unreadable status, admits nothing. A ready credential admits disconnecting (revocation); no credential admits connecting.
 * The Host refuses either on its own if any of this changed since the read.
 */
function cloudflareAdmittedActions(cloudflare: CloudflareRead | null, writable: boolean): readonly ("connect" | "disconnect")[] {
  if (!writable || cloudflare === null || cloudflare.status === null || !cloudflare.status.qualified || !cloudflare.status.capturable) return [];
  const { notice, status } = cloudflare;
  if (notice === "unreadable" || notice === "busy" || notice === "recovering" || notice === "blocked") return [];
  if (status.state === "ready" && status.connectionRef !== null) return ["disconnect"];
  return status.state === "not-configured" ? ["connect"] : [];
}

type CloudflareRead = Awaited<ReturnType<typeof readCloudflareNotice>>;

export interface OnboardingProps {
  readonly locale: Locale;
  readonly windowFrame: ShellWindowFrame;
  readonly lease: LocalDeviceLease;
  readonly publication: AuthoritativeWorkspacePublication;
  readonly ports: AuthoritativeWorkspacePorts;
  /** Publishes the workspace read taken after a domain was added. */
  readonly onPublication: (publication: AuthoritativeWorkspacePublication) => void;
  /** Leaves onboarding for the workspace; called on skip, on finish, or when a step cannot be shown. */
  readonly onFinish: () => void;
}

/** Production first-run onboarding over the kit wizard. Domains are added only through the create path. */
export function Onboarding({ locale, windowFrame, lease, publication, ports, onPublication, onFinish }: OnboardingProps) {
  const copy = getPresentationCopy(locale, "activation");
  const assetCopy = getPresentationCopy(locale, "assetLibrary");
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(0);
  const mutations = useRef(createPortfolioMutationController(ports.business)).current;
  useEffect(() => () => mutations.unmount(), [mutations]);

  const settingsCopy = getPresentationCopy(locale, "settings");
  const [cloudflare, setCloudflare] = useState<CloudflareRead | null>(null);
  const [cloudflarePending, setCloudflarePending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    if (step !== "connections" && step !== "initial_import") return undefined;
    let current = true;
    void readCloudflareNotice(ports.cloudflare).then((read) => { if (current) setCloudflare(read); });
    return () => { current = false; };
  }, [step, ports]);

  const view = onboardingView(step, lease, publication, locale, cloudflare, cloudflarePending);
  // Connecting creates (or reuses) the connection and has the Host open the native token capture;
  // disconnecting revokes the ready credential. Either way the Host status then decides what shows,
  // including why a refused or failed operation did nothing.
  const toggleProvider = useCallback((providerId: string, connect: boolean) => {
    if (view === null || view.step !== "connections" || cloudflarePending) return;
    const provider = view.providers.find((entry) => entry.providerId === providerId);
    if (provider?.providerId !== "cloudflare" || !provider.admittedActions.includes(connect ? "connect" : "disconnect")) return;
    const connectionRef = cloudflare?.status?.connectionRef ?? null;
    setCloudflarePending(true);
    void (async () => {
      try {
        if (connect) {
          const created = await ports.cloudflare.create("Cloudflare");
          await ports.cloudflare.activate(created.connectionRef);
        } else if (connectionRef !== null) {
          await ports.cloudflare.revoke(connectionRef);
        }
      } catch {
        // The Host's status names the reason; the settle read below reports it.
      }
      const read = await settleCloudflareNotice(ports.cloudflare, () => mounted.current);
      if (!mounted.current) return;
      setCloudflare(read);
      setCloudflarePending(false);
    })();
  }, [view, cloudflarePending, cloudflare, ports]);
  useEffect(() => { if (view === null) onFinish(); }, [view, onFinish]);
  if (view === null) return null;

  const onAction = (action: Exclude<ActivationAction, "submit_device" | "connect_provider" | "disconnect_provider">) => {
    if (!view.availableActions.includes(action)) return;
    const index = steps.indexOf(step);
    if (action === "skip" || action === "enter_workspace") onFinish();
    else if (action === "back") setStep(steps[Math.max(0, index - 1)]!);
    else if (action === "continue") setStep(steps[Math.min(steps.length - 1, index + 1)]!);
  };
  // Same path as the asset library: the domain is the deduplication key, so a repeat is `exists`.
  const addDomain = async (domain: CanonicalDomainName): Promise<AddDomainOutcome> => {
    const result = await addDomainAsset(ports.business, mutations, domain, publication.status.readGeneration);
    if (result.outcome !== "added") return result.outcome;
    setAdded((count) => count + 1);
    // The add is committed; a failed re-read only leaves the counts stale until the next publication.
    void readAuthoritativeWorkspacePublication(ports, result.accepted.receipt.readGeneration).then(onPublication, () => undefined);
    return "added";
  };

  return (
    <NativeWindow locale={locale} windowFrame={windowFrame} context={copy.tagline}>
      <div className="onboarding-stage">
        <ActivationWizard
          locale={locale}
          view={view}
          onAction={onAction}
          onToggleProvider={toggleProvider}
          {...(cloudflare === null ? {} : { connectionsNotice: settingsCopy[cloudflareNoticeCopyKey[cloudflare.notice]] })}
          importActions={(
            <>
              {added > 0 ? <span className="gd-t-meta">{copy.addedDomains.replace("{count}", formatNumber(locale, added))}</span> : null}
              <Button size="sm" onClick={() => setAdding(true)}>{assetCopy.addDomain}</Button>
            </>
          )}
        />
      </div>
      <AddDomainDialog locale={locale} open={adding} onClose={() => setAdding(false)} onSubmit={addDomain} />
    </NativeWindow>
  );
}
