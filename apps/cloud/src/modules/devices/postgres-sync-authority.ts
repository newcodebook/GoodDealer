import { identifier } from "@gooddealer/protocol/wire";
import type { AccountTransactionRunner } from "../../db/index";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import type { DefaultWorkspaceTenantResolverPort } from "../workspace/default-workspace/index";
import { readDesktopSessionAuthority, type DesktopSessionAuthority } from "./desktop-session-authority";

export interface DesktopSyncAuthorityPort {
  resolveActiveDevice(principal: PublicPrincipal, workspaceId: string): Promise<string | null>;
  resolveSessionDevice(principal: PublicPrincipal, workspaceId: string): Promise<Pick<DesktopSessionAuthority, "deviceId" | "role"> | null>;
}
export interface DesktopRouteAuthorityPort {
  authorize(principal: PublicPrincipal, requiredRole: "active" | "active_or_standby"): Promise<boolean>;
}

/** Every result comes from a locked current session, binding/key and server Lease state. */
export class PostgresDesktopSyncAuthority implements DesktopSyncAuthorityPort {
  constructor(private readonly transactions: AccountTransactionRunner) {}
  async resolveSessionDevice(principal: PublicPrincipal, workspaceId: string) {
    if (principal.clientKind !== "desktop" || !identifier.safeParse(workspaceId).success) return null;
    return this.transactions.withAccount(principal.accountId, async (transaction) => {
      const current = await readDesktopSessionAuthority(transaction, principal, workspaceId);
      return current === null ? null : { deviceId: current.deviceId, role: current.role };
    });
  }
  async resolveActiveDevice(principal: PublicPrincipal, workspaceId: string): Promise<string | null> {
    const current = await this.resolveSessionDevice(principal, workspaceId);
    return current?.role === "active" ? current.deviceId : null;
  }
}

/** Independent route gate; applications must still recheck their operation-specific authority. */
export class PostgresDesktopRouteAuthority implements DesktopRouteAuthorityPort {
  constructor(private readonly workspaces: DefaultWorkspaceTenantResolverPort, private readonly devices: DesktopSyncAuthorityPort) {}
  async authorize(principal: PublicPrincipal, requiredRole: "active" | "active_or_standby"): Promise<boolean> {
    if (principal.clientKind !== "desktop") return false;
    const scope = await this.workspaces.resolve(principal);
    if (scope === null) return false;
    const device = await this.devices.resolveSessionDevice(principal, scope.workspaceId);
    return device !== null && (requiredRole === "active_or_standby" || device.role === "active");
  }
}
