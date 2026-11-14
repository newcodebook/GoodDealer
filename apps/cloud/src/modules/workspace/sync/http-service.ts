import {
  workspaceCheckpointReadRequestSchema,
  workspaceRebootstrapRequestSchema,
  workspaceMutationPullRequestSchema,
  workspaceMutationPushRequestSchema,
  type WorkspaceMutationPullResponse,
  type WorkspaceMutationPushRejectionCode,
  type WorkspaceMutationPushResponse,
} from "@gooddealer/protocol/workspace";
import { randomUUID } from "node:crypto";

import type { PublicPrincipal } from "../../../entrypoints/ports/public-session";
import type { DesktopSyncAuthorityPort } from "../../devices/postgres-sync-authority";
import type { WorkspaceCheckpointReaderPort } from "../checkpoints/postgres-reader";
import type { DefaultWorkspaceTenantResolverPort } from "../default-workspace/index";
import type { MutationIngestRejectionCode } from "../mutations/index";
import { PostgresWorkspaceMutationIngest } from "../mutations/postgres-ingest-service";
import { PostgresReaderCursorService } from "../cursors/postgres-reader-cursor-service";
import type { WorkspaceTenantScope } from "../tenant-scope";

export interface WorkspaceSyncApplicationPort {
  push(value: unknown, principal: PublicPrincipal): Promise<WorkspaceMutationPushResponse>;
  pull(value: unknown, principal: PublicPrincipal): Promise<WorkspaceMutationPullResponse>;
  checkpoint(value: unknown, principal: PublicPrincipal): Promise<unknown>;
  rebootstrap?(value: unknown, principal: PublicPrincipal): Promise<unknown>;
}

/** Authenticated desktop data-plane adapter. All workspace and device selectors are server-derived. */
export class PostgresWorkspaceSyncApplication implements WorkspaceSyncApplicationPort {
  constructor(private readonly dependencies: {
    readonly authority: DesktopSyncAuthorityPort;
    readonly workspaces: DefaultWorkspaceTenantResolverPort;
    readonly mutations: Pick<PostgresWorkspaceMutationIngest, "ingest">;
    readonly readers: Pick<PostgresReaderCursorService, "open" | "pullV2">;
    readonly checkpoints: WorkspaceCheckpointReaderPort;
  }) {}

  async push(value: unknown, principal: PublicPrincipal): Promise<WorkspaceMutationPushResponse> {
    if (principal.clientKind !== "desktop") return rejectedPush("SYNC_AUTHORIZATION_REJECTED");
    const request = workspaceMutationPushRequestSchema.safeParse(value);
    if (!request.success) return rejectedPush("SYNC_INPUT_REJECTED");
    const context = await this.context(principal);
    if (context === null || request.data.mutations.some((mutation) => mutation.sourceDeviceId !== context.deviceId)) {
      return rejectedPush("SYNC_AUTHORIZATION_REJECTED");
    }
    const result = await this.dependencies.mutations.ingest(context.scope, request.data);
    if (!result.accepted) return rejectedPush(mapPushCode(result.code));
    return {
      schemaVersion: 3,
      accepted: true,
      acknowledgements: result.assignments.map((assignment) => ({ ...assignment })),
      headServerRevision: result.headRevision,
    };
  }

  async pull(value: unknown, principal: PublicPrincipal): Promise<WorkspaceMutationPullResponse> {
    if (principal.clientKind !== "desktop") return rejectedPull("SYNC_AUTHORIZATION_REJECTED");
    const request = workspaceMutationPullRequestSchema.safeParse(value);
    if (!request.success) return rejectedPull("SYNC_INPUT_REJECTED");
    const context = await this.context(principal);
    if (context === null) return rejectedPull("SYNC_AUTHORIZATION_REJECTED");
    let result = await this.dependencies.readers.pullV2(context.scope, context.deviceId, request.data);
    if (!result.accepted && result.code === "READER_CURSOR_UNKNOWN") {
      if (request.data.cursor !== null || request.data.confirm !== null) {
        return rejectedPull("SYNC_CURSOR_CONFLICT");
      }
      const opened = await this.dependencies.readers.open(context.scope, {
        deviceId: context.deviceId,
        atRevision: request.data.afterServerRevision,
      });
      if (!opened.accepted) return this.pullRejection(context.scope, mapPullCode(opened.code));
      result = await this.dependencies.readers.pullV2(context.scope, context.deviceId, request.data);
    }
    if (!result.accepted) return this.pullRejection(context.scope, mapPullCode(result.code));
    return {
      schemaVersion: 3,
      accepted: true,
      page: result.page,
      confirmedThrough: result.confirmedThrough,
      pendingDelivery: result.pendingDelivery,
      confirmToken: result.confirmToken,
    };
  }

  async checkpoint(value: unknown, principal: PublicPrincipal): Promise<unknown> {
    if (principal.clientKind !== "desktop") return { schemaVersion: 2, checkpoint: null };
    workspaceCheckpointReadRequestSchema.parse(value);
    const context = await this.context(principal);
    if (context === null) return { schemaVersion: 2, checkpoint: null };
    return { schemaVersion: 2, checkpoint: await this.dependencies.checkpoints.readLatestAvailable(context.scope) };
  }

  async rebootstrap(value: unknown, principal: PublicPrincipal): Promise<unknown> {
    if (principal.clientKind !== "desktop") return null;
    workspaceRebootstrapRequestSchema.parse(value);
    const context = await this.context(principal);
    if (context === null) return null;
    return this.dependencies.checkpoints.readRebootstrapPlan?.(context.scope) ?? null;
  }

  private async context(principal: PublicPrincipal): Promise<{ scope: WorkspaceTenantScope; deviceId: string } | null> {
    const scope = await this.dependencies.workspaces.resolve(principal);
    if (scope === null) return null;
    const deviceId = await this.dependencies.authority.resolveActiveDevice(principal, scope.workspaceId);
    return deviceId === null ? null : { scope, deviceId };
  }

  private async pullRejection(
    scope: WorkspaceTenantScope,
    code: Parameters<typeof rejectedPull>[0],
  ): Promise<WorkspaceMutationPullResponse> {
    const checkpoint = code === "SYNC_REBOOTSTRAP_REQUIRED"
      ? await this.dependencies.checkpoints.readLatestAvailable(scope)
      : null;
    return rejectedPull(code, checkpoint);
  }
}

function rejectedPush(code: WorkspaceMutationPushRejectionCode): WorkspaceMutationPushResponse {
  return { schemaVersion: 3, accepted: false, code, correlationId: `sync-${randomUUID()}` };
}

function rejectedPull(
  code: "SYNC_SCHEMA_UNSUPPORTED" | "SYNC_INPUT_REJECTED" | "SYNC_AUTHORIZATION_REJECTED" | "SYNC_TENANT_UNRESOLVED" | "SYNC_CURSOR_CONFLICT" | "SYNC_REBOOTSTRAP_REQUIRED" | "SYNC_STORAGE_REJECTED",
  checkpoint: Extract<WorkspaceMutationPullResponse, { accepted: false }>["checkpoint"] = null,
): WorkspaceMutationPullResponse {
  return { schemaVersion: 3, accepted: false, code, checkpoint, correlationId: `sync-${randomUUID()}` };
}

/**
 * Maps every ingest rejection exactly. Desktop retries only `SYNC_STORAGE_REJECTED`, so a code
 * belongs there only when a later identical push can succeed: a drain seal lifts, and a base ahead
 * of head or a workspace mismatch means Cloud state regressed or was mis-resolved, which must hold
 * the Outbox rather than end the user's edits. Conflicts with Cloud state never resolve by retry.
 */
function mapPushCode(code: MutationIngestRejectionCode): WorkspaceMutationPushRejectionCode {
  switch (code) {
    case "MUTATION_SCHEMA_VERSION_UNSUPPORTED":
      return "SYNC_SCHEMA_UNSUPPORTED";
    case "WORKSPACE_TENANT_UNRESOLVED":
      return "SYNC_TENANT_UNRESOLVED";
    case "MUTATION_ID_CONFLICT":
    case "MUTATION_SEQUENCE_CONFLICT":
      return "SYNC_IDEMPOTENCY_CONFLICT";
    case "MUTATION_MALFORMED":
    case "MUTATION_BATCH_UNORDERED":
      return "SYNC_INPUT_REJECTED";
    case "MUTATION_DEVICE_NOT_ACTIVE":
    case "MUTATION_EPOCH_STALE":
      return "SYNC_AUTHORIZATION_REJECTED";
    case "MUTATION_FIELD_STALE":
    case "MUTATION_ENTITY_UNKNOWN":
      return "SYNC_MUTATION_CONFLICT";
    case "MUTATION_DRAIN_SEALED":
    case "MUTATION_BASE_REVISION_AHEAD":
    case "MUTATION_WORKSPACE_MISMATCH":
      return "SYNC_STORAGE_REJECTED";
    default: {
      const unreachable: never = code;
      return unreachable;
    }
  }
}

function mapPullCode(code: string): Parameters<typeof rejectedPull>[0] {
  if (code.includes("DEVICE_REMOVED")) return "SYNC_AUTHORIZATION_REJECTED";
  if (code.includes("COMPACTION") || code.includes("TTL") || code.includes("RETIRED")) return "SYNC_REBOOTSTRAP_REQUIRED";
  if (code.includes("CURSOR")) return "SYNC_CURSOR_CONFLICT";
  if (code.includes("TENANT")) return "SYNC_TENANT_UNRESOLVED";
  return "SYNC_STORAGE_REJECTED";
}
