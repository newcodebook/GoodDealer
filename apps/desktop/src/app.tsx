import { defaultLocale, type Locale } from "@gooddealer/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createCloudflarePort,
  createDesktopAuthenticationPort,
  createDesktopWindowControlsPort,
  createLocalBatchOperationsPort,
  createLocalBusinessPort,
  createLocalConflictPort,
  createLocalDeviceLeasePort,
  createLocalDnsHealthPort,
  createLocalHistoryPort,
  createLocalManualTasksPort,
  createLocalRenewalsPort,
  createLocalSalesPort,
  createLocalSettingsPort,
  createLocalPortfolioPresentationPort,
  createLocalSyncStatusPort,
  detectDesktopWindowPlatform,
  type DesktopAuthenticationStatus,
  type LocalDeviceLease,
} from "./adapters/tauri";
import type { ShellWindowFrame } from "./app-shell";
import {
  authenticationLocksRuntime,
  createAuthenticationStatusCoordinator,
  synchronizeAfterAuthentication,
} from "./app/authentication-coordinator";
import { adjudicateDesktopPresentation } from "./app/desktop-presentation";
import { Onboarding, onboardingOffer, onboardingWritable } from "./app/onboarding";
import {
  readAuthoritativeWorkspacePublication,
  type AuthoritativeWorkspacePorts,
  type AuthoritativeWorkspacePublication,
} from "./app/workspace-publication";
import { WorkspaceView } from "./app/workspace-view";
import { RuntimeStatusPage, SignIn } from "./features/runtime-mode";
import "./app.css";

const workspacePorts: AuthoritativeWorkspacePorts = {
  business: createLocalBusinessPort(),
  portfolio: createLocalPortfolioPresentationPort(),
  dns: createLocalDnsHealthPort(),
  settings: createLocalSettingsPort(),
  sales: createLocalSalesPort(),
  renewals: createLocalRenewalsPort(),
  batches: createLocalBatchOperationsPort(),
  history: createLocalHistoryPort(),
  manualTasks: createLocalManualTasksPort(),
  cloudflare: createCloudflarePort(),
  conflicts: createLocalConflictPort(),
  sync: createLocalSyncStatusPort(),
};
const deviceLease = createLocalDeviceLeasePort();
const desktopAuthentication = createDesktopAuthenticationPort();
const windowControls = createDesktopWindowControlsPort();

/**
 * Whether this session shows first-run onboarding. It is decided once, from the first workspace
 * publication, and never offered again in the session after it is skipped or finished.
 */
type OnboardingDecision =
  | { readonly state: "undecided" }
  | { readonly state: "checking" }
  | { readonly state: "offered"; readonly lease: LocalDeviceLease }
  | { readonly state: "declined" };

export type DesktopStartupState =
  | "opening"
  | "host_unavailable"
  | "authentication_required"
  | "security_locked"
  | "retryable_locked"
  | "workspace";

export function desktopStartupState(
  failure: boolean,
  workspace: AuthoritativeWorkspacePublication | null,
): DesktopStartupState {
  if (failure) return "host_unavailable";
  if (workspace === null) return "opening";
  switch (workspace.status.state) {
    case "activation_required": return "authentication_required";
    case "security_locked": return "security_locked";
    case "retryable_locked": return "retryable_locked";
    default: return "workspace";
  }
}

/**
 * Production composition root. It opens the Host-owned workspace, follows Native authentication,
 * and hands the adjudicated presentation to the matching page; it fabricates no authorization and
 * holds no business rows while locked.
 */
export function App() {
  const [workspace, setWorkspace] = useState<AuthoritativeWorkspacePublication | null>(null);
  const [failure, setFailure] = useState(false);
  const [authentication, setAuthentication] = useState<DesktopAuthenticationStatus | null>(null);
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  const [onboarding, setOnboarding] = useState<OnboardingDecision>({ state: "undecided" });
  const synchronizeRef = useRef<() => void>(() => undefined);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  useEffect(() => {
    let active = true;
    let businessSyncGeneration = 0;
    const synchronizeBusiness = async () => {
      const generation = ++businessSyncGeneration;
      const publication = await readAuthoritativeWorkspacePublication(workspacePorts);
      if (!active || generation !== businessSyncGeneration) return;
      setWorkspace(publication);
      setFailure(false);
    };
    const reportFailure = () => {
      if (active) setFailure(true);
    };
    synchronizeRef.current = () => { void synchronizeBusiness().catch(reportFailure); };
    const acceptAuthenticationStatus = async (value: DesktopAuthenticationStatus) => {
      if (!active) return;
      setAuthentication(value);
      // Native has already removed read authority; do not retain sensitive rows while the
      // authoritative business-status snapshot is in flight.
      if (authenticationLocksRuntime(value)) setWorkspace(null);
      await synchronizeAfterAuthentication(value, synchronizeBusiness);
    };
    const authenticationStatuses = createAuthenticationStatusCoordinator(acceptAuthenticationStatus);

    void synchronizeBusiness().catch(reportFailure);
    let unlisten: (() => void) | undefined;
    void desktopAuthentication.onStatus((value) => {
      void authenticationStatuses.acceptEvent(value).catch(reportFailure);
    }).then((dispose) => {
      if (!active) {
        dispose();
        return;
      }
      unlisten = dispose;
      // Read current state only after installing the listener, closing the startup race where
      // authorization could complete between an initial status read and subscription. Capture
      // the event generation so an older IPC response cannot overwrite a newer event.
      const acceptSnapshot = authenticationStatuses.beginSnapshot();
      void desktopAuthentication.status()
        .then(acceptSnapshot)
        .catch(() => {
          if (active) setAuthentication("unavailable");
        });
    }).catch(() => {
      if (active) setAuthentication("unavailable");
    });
    return () => {
      active = false;
      synchronizeRef.current = () => undefined;
      unlisten?.();
    };
  }, []);

  const windowFrame = useMemo((): ShellWindowFrame => ({
    platform: detectDesktopWindowPlatform(typeof navigator === "undefined" ? "" : navigator.userAgent),
    framed: false,
    onMinimize: () => { void windowControls.minimize(); },
    onToggleMaximize: () => { void windowControls.toggleMaximize(); },
    onClose: () => { void windowControls.close(); },
  }), []);
  const beginSignIn = () => { void desktopAuthentication.begin().catch(() => setAuthentication("unavailable")); };
  const refreshAuthorization = () => { void desktopAuthentication.refresh().catch(() => setAuthentication("unavailable")); };
  const retryHost = () => { setFailure(false); synchronizeRef.current(); };

  const presentation = adjudicateDesktopPresentation(failure, workspace, authentication);
  const workspaceReady = presentation.view === "workspace" && workspace !== null;
  useEffect(() => {
    if (!workspaceReady || workspace === null) {
      // A lock or Host loss ends onboarding; a later return decides nothing from the old lease.
      if (onboarding.state === "offered" || onboarding.state === "checking") setOnboarding({ state: "declined" });
      return;
    }
    // Onboarding writes need Active authority; once it is lost the session leaves onboarding, and
    // the lease it read is not reused.
    if ((onboarding.state === "offered" || onboarding.state === "checking") && !onboardingWritable(workspace)) {
      setOnboarding({ state: "declined" });
      return;
    }
    if (onboarding.state !== "undecided") return;
    const offer = onboardingOffer(workspace);
    if (offer === "wait") return;
    if (offer === "decline") {
      setOnboarding({ state: "declined" });
      return;
    }
    setOnboarding({ state: "checking" });
    // The device step shows only the lease the Host verified; without one there is no onboarding.
    void deviceLease.read().then(
      (lease) => setOnboarding({ state: "offered", lease }),
      () => setOnboarding({ state: "declined" }),
    );
  }, [workspaceReady, workspace, onboarding.state]);
  const finishOnboarding = useCallback(() => setOnboarding({ state: "declined" }), []);
  const page = (() => {
    switch (presentation.view) {
      case "opening":
        return <RuntimeStatusPage locale={locale} kind="opening" windowFrame={windowFrame} />;
      case "host_unavailable":
        return <RuntimeStatusPage locale={locale} kind="host_unavailable" windowFrame={windowFrame} onRetry={retryHost} />;
      case "sign_in":
        return (
          <SignIn
            locale={locale}
            state={presentation.signIn}
            windowFrame={windowFrame}
            onBegin={beginSignIn}
            onRetry={refreshAuthorization}
            onLocaleChange={setLocale}
          />
        );
      case "locked":
        return (
          <RuntimeStatusPage
            locale={locale}
            kind={presentation.reason}
            windowFrame={windowFrame}
            onSignInAgain={beginSignIn}
            onRetry={refreshAuthorization}
          />
        );
      case "workspace":
        if (onboarding.state === "offered" && workspace !== null) {
          return (
            <Onboarding
              locale={locale}
              windowFrame={windowFrame}
              lease={onboarding.lease}
              publication={workspace}
              ports={workspacePorts}
              onPublication={setWorkspace}
              onFinish={finishOnboarding}
            />
          );
        }
        if (onboarding.state === "checking") {
          return <RuntimeStatusPage locale={locale} kind="opening" windowFrame={windowFrame} />;
        }
        return (
          <WorkspaceView
            locale={locale}
            presentation={presentation}
            ports={workspacePorts}
            windowFrame={windowFrame}
            onPublication={setWorkspace}
            onRefresh={() => synchronizeRef.current()}
            onLocaleChange={setLocale}
          />
        );
    }
  })();

  return (
    <div
      className="desktop-root"
      data-desktop-state={desktopStartupState(failure, workspace)}
      {...(authentication === null ? {} : { "data-authentication": authentication })}
    >
      {page}
    </div>
  );
}
