import { defaultLocale, type Locale } from "@gooddealer/i18n";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createDesktopAuthenticationPort,
  createDesktopWindowControlsPort,
  createLocalBusinessPort,
  createLocalConflictPort,
  createLocalPortfolioPresentationPort,
  createLocalSyncStatusPort,
  detectDesktopWindowPlatform,
  type DesktopAuthenticationStatus,
} from "./adapters/tauri";
import type { ShellWindowFrame } from "./app-shell";
import {
  authenticationLocksRuntime,
  createAuthenticationStatusCoordinator,
  synchronizeAfterAuthentication,
} from "./app/authentication-coordinator";
import { adjudicateDesktopPresentation } from "./app/desktop-presentation";
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
  conflicts: createLocalConflictPort(),
  sync: createLocalSyncStatusPort(),
};
const desktopAuthentication = createDesktopAuthenticationPort();
const windowControls = createDesktopWindowControlsPort();

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
        return (
          <WorkspaceView
            locale={locale}
            presentation={presentation}
            ports={workspacePorts}
            windowFrame={windowFrame}
            onPublication={setWorkspace}
            onRefresh={() => synchronizeRef.current()}
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
