import type {
  AccountGateStatus,
  AccountLockReason,
  AccountRejection,
  AccountSessionClientKind,
  AccountSessionList,
  AccountSessionSummary,
  AuthRevocationReason,
  AuthSessionState,
  AuthSessionStatus,
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

export interface AuthSurfaceView extends AccountSurfaceView {
  authState: AuthSessionState;
  accountId: string | null;
  sessionId: string | null;
  revocationReason: AuthRevocationReason | null;
}

export type SessionInventoryStatus = AccountSessionSummary["status"];

export interface SessionInventoryItemView {
  sessionId: string;
  clientKind: AccountSessionClientKind;
  deviceId: string | null;
  displayName: string;
  createdAt: string;
  lastSeenAt: string;
  currentSession: boolean;
  status: SessionInventoryStatus;
  revokedAt: string | null;
}

export interface SessionInventoryView {
  listRevision: number;
  sessions: readonly SessionInventoryItemView[];
}

/** Read-only Host boundary. Runtime authority and transitions remain in Rust. */
export interface RuntimeStatusPort {
  getStatus(): Promise<RuntimeStatus>;
}

/** Read-only account gate projection produced by the authoritative boundary. */
export interface AccountGatePort {
  getGateStatus(): Promise<AccountGateStatus>;
}

/** Read-only Host and Cloud boundary for redacted session projections. */
export interface AuthSessionPort {
  getAuthStatus(): Promise<AuthSessionStatus>;
  listSessions(): Promise<AccountSessionList>;
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

/**
 * Pure auth routing composition. Its inputs are already-adjudicated views; it
 * can only preserve or reduce the account surface and never grants authority.
 */
export function projectAuthSurface(
  account: AccountSurfaceView,
  gate: AccountGateStatus,
  auth: AuthSessionStatus,
): AuthSurfaceView {
  const sessionUnavailable = auth.state === "signed_out" || auth.state === "revoked";
  const sessionRestricted = auth.state === "refresh_required" || auth.state === "reauth_required";
  const surface = sessionUnavailable || gate.outcome === "locked"
    ? "locked"
    : sessionRestricted && (account.surface === "active" || account.surface === "activating")
      ? "standby_read_only"
      : account.surface;

  return {
    surface,
    lockReason: gate.lockReason,
    capabilities: sessionUnavailable
      ? []
      : surface === "active"
        ? [...account.capabilities]
        : account.capabilities.filter((capability) => !isActiveOnlyCapability(capability)),
    authState: auth.state,
    accountId: auth.accountId,
    sessionId: auth.sessionId,
    revocationReason: auth.revocationReason,
  };
}

/** Copies the frozen wire DTO into a client-owned, display-only inventory. */
export function projectSessionInventory(inventory: AccountSessionList): SessionInventoryView {
  return {
    listRevision: inventory.listRevision,
    sessions: inventory.sessions.map((session) => ({
      sessionId: session.sessionId,
      clientKind: session.clientKind,
      deviceId: session.deviceId,
      displayName: session.displayName,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      currentSession: session.currentSession,
      status: session.status,
      revokedAt: session.revokedAt,
    })),
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
