import {
  projectActivationWizardViewModel,
  type ActivationAction,
  type ActivationWizardViewModel,
  type CanonicalDomainName,
} from "@gooddealer/client-core";
import { formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Button } from "@gooddealer/ui";
import { useEffect, useRef, useState } from "react";

import type { LocalDeviceLease } from "../adapters/tauri";
import { NativeWindow, type ShellWindowFrame } from "../app-shell";
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
 * - Cloudflare is listed as unavailable: no capability is qualified (ADR-0024), so no connection
 *   path exists in production, and there is nothing to import from observations either.
 * - Completion reports the workspace's domain count and the applied server revision.
 */
export function onboardingView(
  step: OnboardingStep,
  lease: LocalDeviceLease,
  publication: AuthoritativeWorkspacePublication,
  locale: Locale,
): ActivationWizardViewModel | null {
  const copy = getPresentationCopy(locale, "activation");
  const sync = publication.sync;
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
          providers: [{ providerId: "cloudflare", displayName: "Cloudflare", metadata: "API Token", category: "dns", connectionState: "unavailable", admittedActions: [] }],
          connectedCount: 0,
          availableActions: ["back", "continue"],
        };
      case "initial_import":
        return {
          step,
          connectedCount: 0,
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

  const view = onboardingView(step, lease, publication, locale);
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
