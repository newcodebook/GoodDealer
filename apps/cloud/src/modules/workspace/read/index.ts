import {
  WORKSPACE_SYNC_SCHEMA_VERSION,
  encodeMutationPageDigestInput,
  mutationPageSchema,
  workspacePortfolioReadRequestSchema,
  workspacePortfolioReadResponseSchema,
  type MutationPage,
  type WorkspacePortfolioReadResponse,
} from "@gooddealer/protocol/workspace";
import { encodeDomainSeparatedWireValue } from "@gooddealer/protocol/wire";

import type { WorkspaceBindingPort } from "../revisions/index";
import type { WorkspaceMutationQueryPort } from "../mutations/index";
import type { PortfolioProjectionQueryPort } from "../state/portfolio/index";
import {
  parseWorkspaceTenantScope,
  type WorkspaceTenantScope,
} from "../tenant-scope";

export type DomainAssetReplicaRecoveryRejectionCode = "WORKSPACE_TENANT_UNRESOLVED";

export class DomainAssetReplicaRecoveryError extends Error {
  constructor(readonly code: DomainAssetReplicaRecoveryRejectionCode) {
    super(code);
    this.name = "DomainAssetReplicaRecoveryError";
  }
}

/**
 * Tenant-scoped recovery boundary for a sanitized domain-asset sync replica.
 * Authentication and account-to-workspace binding are resolved before this service;
 * the wire request is never allowed to select an account scope. This is not a Desktop business
 * Repository: callers must validate and merge the result into local SQLCipher before local Query.
 */
export class DomainAssetReplicaRecoveryService {
  readonly #projection: PortfolioProjectionQueryPort;

  constructor(projection: PortfolioProjectionQueryPort) {
    this.#projection = projection;
  }

  async read(scope: WorkspaceTenantScope, value: unknown): Promise<WorkspacePortfolioReadResponse> {
    const tenantScope = parseWorkspaceTenantScope(scope);
    if (tenantScope === null) {
      throw new DomainAssetReplicaRecoveryError("WORKSPACE_TENANT_UNRESOLVED");
    }
    workspacePortfolioReadRequestSchema.parse(value);
    return workspacePortfolioReadResponseSchema.parse(
      await this.#projection.readPortfolio(tenantScope),
    );
  }
}

export interface WorkspaceSha256Port {
  digest(bytes: Uint8Array): Promise<Uint8Array>;
}

export interface MutationPageRequest {
  readonly fromServerRevisionExclusive: number;
  readonly throughServerRevisionInclusive: number;
  readonly cursor: string | null;
  readonly pageLimit: number;
}

export type MutationPageRejectionCode =
  | "WORKSPACE_TENANT_UNRESOLVED"
  | "MUTATION_PAGE_RANGE_INVALID"
  | "MUTATION_CURSOR_MISMATCH"
  | "MUTATION_PAGE_COMPACTED";

export class MutationPageReadError extends Error {
  constructor(readonly code: MutationPageRejectionCode) {
    super(code);
    this.name = "MutationPageReadError";
  }
}

/** Fixture-only immutable mutation paging implementing the exact Bootstrap MutationPagePort. */
export class InMemoryWorkspaceMutationReader {
  readonly #bindings: WorkspaceBindingPort;
  readonly #mutations: WorkspaceMutationQueryPort;
  readonly #sha256: WorkspaceSha256Port;

  constructor(options: {
    readonly bindings: WorkspaceBindingPort;
    readonly mutations: WorkspaceMutationQueryPort;
    readonly sha256: WorkspaceSha256Port;
  }) {
    this.#bindings = options.bindings;
    this.#mutations = options.mutations;
    this.#sha256 = options.sha256;
  }

  async readPage(scope: WorkspaceTenantScope, request: MutationPageRequest): Promise<MutationPage> {
    const binding = this.#bindings.resolveWorkspace(scope);
    if (!binding.bound) throw new MutationPageReadError("WORKSPACE_TENANT_UNRESOLVED");
    if (
      !Number.isSafeInteger(request.fromServerRevisionExclusive) ||
      !Number.isSafeInteger(request.throughServerRevisionInclusive) ||
      !Number.isSafeInteger(request.pageLimit) ||
      request.fromServerRevisionExclusive < 0 ||
      request.throughServerRevisionInclusive < request.fromServerRevisionExclusive ||
      request.pageLimit < 1 ||
      request.pageLimit > 256
    ) throw new MutationPageReadError("MUTATION_PAGE_RANGE_INVALID");
    if (request.fromServerRevisionExclusive < binding.compactedThroughServerRevision) {
      throw new MutationPageReadError("MUTATION_PAGE_COMPACTED");
    }
    if (
      request.cursor !== null &&
      request.cursor !== encodeCursor(scope, request.throughServerRevisionInclusive, request.fromServerRevisionExclusive)
    ) throw new MutationPageReadError("MUTATION_CURSOR_MISMATCH");

    const returnedThroughServerRevision = Math.min(
      request.throughServerRevisionInclusive,
      request.fromServerRevisionExclusive + request.pageLimit,
    );
    const mutations = this.#mutations.readCommitted(
      scope,
      request.fromServerRevisionExclusive,
      returnedThroughServerRevision,
    );
    if (mutations.length !== returnedThroughServerRevision - request.fromServerRevisionExclusive) {
      throw new MutationPageReadError("MUTATION_PAGE_RANGE_INVALID");
    }
    const nextCursor = returnedThroughServerRevision === request.throughServerRevisionInclusive
      ? null
      : encodeCursor(scope, request.throughServerRevisionInclusive, returnedThroughServerRevision);
    const draft = {
      schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
      workspaceId: scope.workspaceId,
      fromServerRevisionExclusive: request.fromServerRevisionExclusive,
      throughServerRevisionInclusive: request.throughServerRevisionInclusive,
      mutations,
      returnedThroughServerRevision,
      nextCursor,
    };
    const pageDigest = Buffer.from(await this.#sha256.digest(encodeMutationPageDigestInput({
      ...draft,
      pageDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    }))).toString("base64url");

    // Zod parsing fixes field order as well as shape; Bootstrap compares this object byte-for-byte.
    return mutationPageSchema.parse({ ...draft, pageDigest });
  }
}

function encodeCursor(
  scope: WorkspaceTenantScope,
  throughServerRevisionInclusive: number,
  returnedThroughServerRevision: number,
): string {
  return Buffer.from(encodeDomainSeparatedWireValue("GOODDEALER-WORKSPACE-MUTATION-CURSOR-V1", {
    accountId: scope.accountId,
    workspaceId: scope.workspaceId,
    throughServerRevisionInclusive,
    returnedThroughServerRevision,
  })).toString("base64url");
}
