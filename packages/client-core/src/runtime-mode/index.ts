import type {
  AccountGateStatus,
  AccountLockReason,
  EntitlementProjection,
} from "@gooddealer/protocol/account";
import type {
  ActiveDeviceLeaseStatus,
  CloudScope,
  DeviceAuthorityProjection,
  DeviceBindingList,
  RuntimeStatus,
} from "@gooddealer/protocol/devices";

export type RuntimeMode = RuntimeStatus["mode"];

export type AccountSurface =
  | "locked"
  | "standby_read_only"
  | "activating"
  | "active"
  | "local_continuation";

export interface AccountSurfaceView {
  surface: AccountSurface;
  lockReason: AccountLockReason | null;
  capabilities: readonly CloudScope[];
}

/** Read-only Host boundary. Runtime authority and transitions remain in Rust. */
export interface RuntimeStatusPort {
  getStatus(): Promise<RuntimeStatus>;
}

/** Read-only account gate projection produced by the authoritative boundary. */
export interface AccountGatePort {
  getGateStatus(): Promise<AccountGateStatus>;
}

/** Read-only device directory and already-decided authority projections. */
export interface DeviceDirectoryPort {
  listBindings(): Promise<DeviceBindingList>;
  getLeaseStatus(): Promise<ActiveDeviceLeaseStatus>;
  getAuthority(): Promise<DeviceAuthorityProjection>;
}

/** Read-only commercial entitlement projection. */
export interface EntitlementPort {
  getEntitlement(): Promise<EntitlementProjection>;
}

function isActiveOnlyCapability(scope: CloudScope): boolean {
  return (
    scope === "operation:approve" ||
    scope === "workspace:mutate" ||
    scope.startsWith("platform:")
  );
}

/**
 * Pure UI routing projection. The Host and Cloud have already decided every
 * authority input; this function performs no clock arithmetic and grants
 * nothing.
 */
export function projectAccountSurface(
  runtime: RuntimeStatus,
  gate: AccountGateStatus,
  lease: ActiveDeviceLeaseStatus,
  authority: DeviceAuthorityProjection,
): AccountSurfaceView {
  let surface: AccountSurface;

  if (runtime.mode === "locked" || gate.outcome === "locked") {
    surface = "locked";
  } else if (authority.role === "none") {
    surface = "locked";
  } else if (runtime.mode === "local_continuation") {
    surface = "local_continuation";
  } else if (runtime.mode === "standby" || gate.outcome === "standby_eligible") {
    surface = "standby_read_only";
  } else if (runtime.mode === "activating" || runtime.mode === "draining") {
    surface = "activating";
  } else if (authority.role === "standby") {
    surface = "standby_read_only";
  } else {
    surface = lease.held ? "active" : "standby_read_only";
  }

  return {
    surface,
    lockReason: gate.lockReason,
    capabilities:
      surface === "active"
        ? [...authority.scopes]
        : authority.scopes.filter((scope) => !isActiveOnlyCapability(scope)),
  };
}
