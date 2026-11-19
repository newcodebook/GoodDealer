import {
  DEVICE_MANAGEMENT_SCHEMA_VERSION,
  deviceSwitchDrainRequestSchema,
  deviceSwitchLookupRequestSchema,
  deviceSwitchRequestSchema,
  type DeviceSwitchResponse,
} from "@gooddealer/protocol/devices";

import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import type { DefaultWorkspaceTenantResolverPort } from "../workspace/default-workspace/index";
import type { PostgresDeviceSwitchDrain } from "./postgres-switch-drain";
import type { PostgresDeviceSwitchRequests } from "./postgres-switch-requests";
import type { DesktopSyncAuthorityPort } from "./postgres-sync-authority";

/** A `null` result is an authorization denial; the route answers it without detail. */
export interface DeviceSwitchApplicationPort {
  request(value: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null>;
  status(value: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null>;
  cancel(value: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null>;
  /** Absent until the drain path is composed; the route is then not registered. */
  drain?(value: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null>;
}

/**
 * Desktop device switch adapter (ADR-0032 S1b). Account, workspace and device come only from the
 * authenticated session: the caller must be the Desktop holding the workspace's current Lease.
 * Production has no session for a device without the Lease, so forced takeover, which starts on
 * the target device, is refused as unavailable until that decision is made (ADR-0032 待决).
 */
export class PostgresDeviceSwitchApplication implements DeviceSwitchApplicationPort {
  constructor(private readonly dependencies: {
    readonly workspaces: DefaultWorkspaceTenantResolverPort;
    readonly authority: DesktopSyncAuthorityPort;
    readonly requests: Pick<PostgresDeviceSwitchRequests, "requestNormal" | "read" | "cancel">;
    readonly drains: Pick<PostgresDeviceSwitchDrain, "submit">;
  }) {}

  async request(value: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null> {
    const request = deviceSwitchRequestSchema.parse(value);
    const subject = await this.#subject(principal);
    if (subject === null) return null;
    if (request.mode === "forced") {
      return { schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION, accepted: false, code: "FORCED_SWITCH_UNAVAILABLE" };
    }
    return this.dependencies.requests.requestNormal(subject, request);
  }

  async status(value: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null> {
    const request = deviceSwitchLookupRequestSchema.parse(value);
    const subject = await this.#subject(principal, true);
    return subject === null ? null : this.dependencies.requests.read(subject, request.requestId);
  }

  async cancel(value: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null> {
    const request = deviceSwitchLookupRequestSchema.parse(value);
    const subject = await this.#subject(principal);
    return subject === null ? null : this.dependencies.requests.cancel(subject, request.requestId);
  }

  /** The source device hands its switch to bootstrap with its signed drain proof (S1c2). */
  async drain(value: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null> {
    const request = deviceSwitchDrainRequestSchema.parse(value);
    const subject = await this.#subject(principal);
    return subject === null ? null : this.dependencies.drains.submit(subject, request.requestId, request.proof);
  }

  async #subject(principal: PublicPrincipal, allowStandby = false) {
    if (principal.clientKind !== "desktop") return null;
    const scope = await this.dependencies.workspaces.resolve(principal);
    if (scope === null) return null;
    const session = await this.dependencies.authority.resolveSessionDevice(principal, scope.workspaceId);
    const deviceId = session !== null && (allowStandby || session.role === "active") ? session.deviceId : null;
    return deviceId === null ? null : { accountId: scope.accountId, workspaceId: scope.workspaceId, deviceId };
  }
}
