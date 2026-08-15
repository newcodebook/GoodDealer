import {
  encodeMutationPageDigestInput,
  mutationPageSchema,
  type MutationPage,
} from "@gooddealer/protocol/workspace";
import { encodeDomainSeparatedWireValue } from "@gooddealer/protocol/wire";

import type { WorkspaceBindingPort } from "../revisions/index";
import type { WorkspaceMutationQueryPort } from "../mutations/index";
import type { WorkspaceTenantScope } from "../tenant-scope";

export interface WorkspaceSha256Port {
  digest(bytes: Uint8Array): Promise<Uint8Array>;
}

export interface MutationPageRequest {
  readonly fromRevisionExclusive: number;
  readonly throughRevisionInclusive: number;
  readonly cursor: string | null;
  readonly pageLimit: number;
}

export type MutationPageReadResult =
  | { readonly accepted: true; readonly page: MutationPage }
  | {
    readonly accepted: false;
    readonly code:
      | "WORKSPACE_TENANT_UNRESOLVED"
      | "MUTATION_PAGE_RANGE_INVALID"
      | "MUTATION_CURSOR_MISMATCH"
      | "MUTATION_PAGE_COMPACTED";
  };

/** Fixture-only immutable mutation paging; cursor tokens bind the resolved account and workspace. */
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

  async readPage(scope: WorkspaceTenantScope, request: MutationPageRequest): Promise<MutationPageReadResult> {
    const binding = this.#bindings.resolveWorkspace(scope);
    if (!binding.bound) return { accepted: false, code: "WORKSPACE_TENANT_UNRESOLVED" };
    if (
      !Number.isSafeInteger(request.fromRevisionExclusive) ||
      !Number.isSafeInteger(request.throughRevisionInclusive) ||
      !Number.isSafeInteger(request.pageLimit) ||
      request.fromRevisionExclusive < 0 ||
      request.throughRevisionInclusive < request.fromRevisionExclusive ||
      request.pageLimit < 1 ||
      request.pageLimit > 256
    ) return { accepted: false, code: "MUTATION_PAGE_RANGE_INVALID" };
    if (request.fromRevisionExclusive < binding.compactionWatermark) {
      return { accepted: false, code: "MUTATION_PAGE_COMPACTED" };
    }
    if (
      request.cursor !== null &&
      request.cursor !== encodeCursor(scope, request.throughRevisionInclusive, request.fromRevisionExclusive)
    ) return { accepted: false, code: "MUTATION_CURSOR_MISMATCH" };

    const returnedThroughRevision = Math.min(
      request.throughRevisionInclusive,
      request.fromRevisionExclusive + request.pageLimit,
    );
    const mutations = this.#mutations.readCommitted(
      scope,
      request.fromRevisionExclusive,
      returnedThroughRevision,
    );
    if (mutations.length !== returnedThroughRevision - request.fromRevisionExclusive) {
      return { accepted: false, code: "MUTATION_PAGE_RANGE_INVALID" };
    }
    const nextCursor = returnedThroughRevision === request.throughRevisionInclusive
      ? null
      : encodeCursor(scope, request.throughRevisionInclusive, returnedThroughRevision);
    const draft = {
      schemaVersion: 1 as const,
      workspaceId: scope.workspaceId,
      fromRevisionExclusive: request.fromRevisionExclusive,
      throughRevisionInclusive: request.throughRevisionInclusive,
      mutations,
      returnedThroughRevision,
      nextCursor,
    };
    const pageDigest = Buffer.from(await this.#sha256.digest(encodeMutationPageDigestInput({
      ...draft,
      pageDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    }))).toString("base64url");
    return { accepted: true, page: mutationPageSchema.parse({ ...draft, pageDigest }) };
  }
}

function encodeCursor(
  scope: WorkspaceTenantScope,
  throughRevisionInclusive: number,
  returnedThroughRevision: number,
): string {
  return Buffer.from(encodeDomainSeparatedWireValue("GOODDEALER-WORKSPACE-MUTATION-CURSOR-V1", {
    accountId: scope.accountId,
    workspaceId: scope.workspaceId,
    throughRevisionInclusive,
    returnedThroughRevision,
  })).toString("base64url");
}
