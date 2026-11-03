import type { DesktopAuthenticationStatus } from "../adapters/tauri";
import type { BrowserSignInState } from "../features/runtime-mode";
import type { AppRouteId } from "./app-route";
import { parseDesktopSurface, type WorkspaceDesktopSurface } from "./desktop-surface";
import { eligibleWorkspaceRouteIds, type AuthoritativeWorkspacePublication } from "./workspace-publication";

/** Routes whose renderer is composed in production; a route without one is never offered. */
export const composedRouteIds: readonly AppRouteId[] = ["portfolio.list", "portfolio.detail", "sync.conflicts"];

type BrowserSignInPresentation = BrowserSignInState;

export type DesktopPresentation =
  | { readonly view: "opening" }
  | { readonly view: "host_unavailable" }
  | { readonly view: "sign_in"; readonly signIn: BrowserSignInPresentation }
  | { readonly view: "locked"; readonly reason: "security_locked" | "retryable_locked" }
  | {
    readonly view: "workspace";
    readonly surface: WorkspaceDesktopSurface;
    /**
     * Why writes are withheld; null only for an Active device with the mutate capability.
     * "restricted" is an Active state whose status omits mutate: writes stay hidden without a banner.
     */
    readonly readOnly: "standby" | "commercial" | "restricted" | null;
    readonly publication: AuthoritativeWorkspacePublication & {
      readonly portfolio: NonNullable<AuthoritativeWorkspacePublication["portfolio"]>;
      readonly conflicts: NonNullable<AuthoritativeWorkspacePublication["conflicts"]>;
      readonly sync: NonNullable<AuthoritativeWorkspacePublication["sync"]>;
    };
  };

function signInPresentation(status: DesktopAuthenticationStatus): BrowserSignInPresentation {
  switch (status) {
    case "unavailable": return "host_unavailable";
    // Native finished OAuth but the Host has not admitted the workspace yet.
    case "authenticated": return "establishing";
    default: return status;
  }
}

/**
 * Chooses what the window may show from Host facts alone. Every branch fails closed: missing,
 * partial, or contradictory evidence yields a route-free page, never a workspace.
 */
export function adjudicateDesktopPresentation(
  failure: boolean,
  workspace: AuthoritativeWorkspacePublication | null,
  authentication: DesktopAuthenticationStatus | null,
): DesktopPresentation {
  if (failure) return { view: "host_unavailable" };
  if (workspace === null) return { view: "opening" };
  const { status } = workspace;
  switch (status.state) {
    case "activation_required":
      // Until Native reports a status, the gate cannot say which sign-in step applies.
      return authentication === null ? { view: "opening" } : { view: "sign_in", signIn: signInPresentation(authentication) };
    case "security_locked":
    case "retryable_locked":
      return { view: "locked", reason: status.state };
    case "commercial_read_only":
    case "standby_read_only":
    case "active": {
      const { portfolio, conflicts, sync } = workspace;
      if (!status.capabilities.includes("local:read") || portfolio === null || conflicts === null || sync === null) {
        return { view: "host_unavailable" };
      }
      const mutable = status.state === "active" && status.capabilities.includes("workspace:mutate");
      const routeIds = eligibleWorkspaceRouteIds(sync).filter((id) => composedRouteIds.includes(id));
      const surface = parseDesktopSurface({
        kind: status.state === "standby_read_only" ? "standby" : "active",
        authorityEvidence: "complete",
        availableRouteIds: routeIds,
        defaultRouteId: "portfolio.list",
      });
      if (surface === null || (surface.kind !== "standby" && surface.kind !== "active")) return { view: "host_unavailable" };
      return {
        view: "workspace",
        surface,
        readOnly: mutable ? null
          : status.state === "commercial_read_only" ? "commercial"
            : status.state === "standby_read_only" ? "standby" : "restricted",
        publication: { status, portfolio, conflicts, sync },
      };
    }
  }
}
