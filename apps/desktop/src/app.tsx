import { useEffect, useState } from "react";

import {
  createDesktopAuthenticationPort,
  createLocalBusinessPort,
  createLocalConflictPort,
  createLocalPortfolioPresentationPort,
  createLocalSyncStatusPort,
  type DesktopAuthenticationStatus,
} from "./adapters/tauri";
import {
  authenticationLocksRuntime,
  createAuthenticationStatusCoordinator,
  synchronizeAfterAuthentication,
} from "./app/authentication-coordinator";
import {
  readAuthoritativeWorkspacePublication,
  type AuthoritativeWorkspacePorts,
  type AuthoritativeWorkspacePublication,
} from "./app/workspace-publication";

const workspacePorts: AuthoritativeWorkspacePorts = {
  business: createLocalBusinessPort(),
  portfolio: createLocalPortfolioPresentationPort(),
  conflicts: createLocalConflictPort(),
  sync: createLocalSyncStatusPort(),
};
const desktopAuthentication = createDesktopAuthenticationPort();

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
 * Production composition root. It opens the Host-owned workspace and follows Native
 * authentication; it fabricates no authorization and holds no business rows while locked.
 *
 * Temporary exception: the previous presentation layer was removed so the Desktop UI can be
 * rebuilt from `brand/`. Until the new shell lands, this root renders only an unstyled startup
 * state; remove this placeholder when the rebuilt shell and routes are composed here.
 */
export function App() {
  const [workspace, setWorkspace] = useState<AuthoritativeWorkspacePublication | null>(null);
  const [failure, setFailure] = useState(false);
  const [authentication, setAuthentication] = useState<DesktopAuthenticationStatus | null>(null);

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
    const acceptAuthenticationStatus = async (value: DesktopAuthenticationStatus) => {
      if (!active) return;
      setAuthentication(value);
      // Native has already removed read authority; do not retain sensitive rows while the
      // authoritative business-status snapshot is in flight.
      if (authenticationLocksRuntime(value)) setWorkspace(null);
      await synchronizeAfterAuthentication(value, synchronizeBusiness);
    };
    const reportFailure = () => {
      if (active) setFailure(true);
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
      unlisten?.();
    };
  }, []);

  const state = desktopStartupState(failure, workspace);
  return (
    <main
      aria-label="GoodDealer Desktop"
      data-desktop-state={state}
      {...(authentication === null ? {} : { "data-authentication": authentication })}
    >
      GoodDealer
    </main>
  );
}
