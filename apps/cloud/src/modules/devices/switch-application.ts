import {
  DEVICE_MANAGEMENT_SCHEMA_VERSION,
  deviceSwitchDrainRequestSchema,
  deviceSwitchLookupRequestSchema,
  deviceSwitchRequestSchema,
  type DeviceSwitchResponse,
} from "@gooddealer/protocol/devices";

import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import type { DefaultWorkspaceTenantResolverPort } from "../workspace/default-workspace/index";
import type { PostgresForcedTakeover } from "./postgres-forced-takeover";
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
 * authenticated session. Status permits either eligible participant, including Standby; request,
 * normal cancel and drain require Active. Forced requests use the target-owned authenticated transaction.
 */
export class PostgresDeviceSwitchApplication implements DeviceSwitchApplicationPort {
  constructor(private readonly dependencies: {
    readonly workspaces: DefaultWorkspaceTenantResolverPort;
    readonly authority: DesktopSyncAuthorityPort;
    readonly requests: Pick<PostgresDeviceSwitchRequests, "requestNormal" | "read" | "cancel">;
    readonly forced?: Pick<PostgresForcedTakeover, "request" | "cancelIfForced">;
    readonly drains: Pick<PostgresDeviceSwitchDrain, "submit">;
  }) {}

  async request(value: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null> {
    const request = deviceSwitchRequestSchema.parse(value);
    if (request.mode === "forced") {
      if (this.dependencies.forced !== undefined) return this.dependencies.forced.request(request, principal);
      return { schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION, accepted: false, code: "FORCED_SWITCH_UNAVAILABLE" };
    }
    const subject = await this.#subject(principal);
    return subject === null ? null : this.dependencies.requests.requestNormal(subject, request);
  }

  async status(value: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null> {
    const request = deviceSwitchLookupRequestSchema.parse(value);
    const subject = await this.#subject(principal, true);
    return subject === null ? null : this.dependencies.requests.read(subject, request.requestId);
  }

  async cancel(value: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null> {
    const request = deviceSwitchLookupRequestSchema.parse(value);
    if (this.dependencies.forced !== undefined) {
      const forced = await this.dependencies.forced.cancelIfForced(request, principal);
      if (forced !== undefined) return forced;
    }
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
