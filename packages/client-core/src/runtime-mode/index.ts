import type {
  AccountGateStatus,
  AccountLockReason,
  AccountRejection,
  EntitlementProjection,
} from "@gooddealer/protocol/account";
import type {
  ActiveDeviceLeaseStatus,
  CloudScope,
  DeviceAuthorityProjection,
  DeviceBindingList,
  DeviceSwitchRequest,
  DeviceSwitchRequestView,
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

/** Read-only consumer surface. Cloud adjudicates every returned field and rejection. */
export interface DeviceSwitchPort {
  requestSwitch(request: DeviceSwitchRequest): Promise<DeviceSwitchRequestView | AccountRejection>;
  getSwitchStatus(requestId: string): Promise<DeviceSwitchRequestView | null>;
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

export type SwitchProgress =
  | "idle"
  | "awaiting_drain"
  | "awaiting_takeover_window"
  | "rebuilding"
  | "finished"
  | "abandoned";

/**
 * Pure display progress from the server-adjudicated switch state. In particular,
 * the takeover timestamp is display data; only a server command can decide when
 * the waiting state may advance.
 */
export function projectSwitchProgress(view: DeviceSwitchRequestView | null): SwitchProgress {
  if (view === null) return "idle";

  switch (view.status) {
    case "draining":
      return view.fromDeviceId === null ? "idle" : "awaiting_drain";
    case "waiting_expiry":
      return view.mode === "forced" && view.earliestTakeoverAt !== null
        ? "awaiting_takeover_window"
        : "idle";
    case "bootstrapping":
      return view.bootstrapExpiresAt === null ? "idle" : "rebuilding";
    case "completed":
      return "finished";
    case "cancelled":
    case "failed":
      return "abandoned";
    case "requested":
    default:
      return "idle";
  }
}
