import { createHash } from "node:crypto";

import {
  WORKSPACE_SYNC_SCHEMA_VERSION,
  encodeMutationPageDigestInput,
  mutationPageSchema,
} from "@gooddealer/protocol/workspace";

import type { TenantTransaction } from "../../../db/index";
import type { BootstrapMutationPagePort } from "../../devices/bootstrap-persistence-ports";
import { PostgresWorkspaceMutationRepository } from "./postgres-repository";

/** Mutation-owned dense paging adapter. Cursor presentation is derived from landed revision. */
export class PostgresBootstrapMutationPagePort implements BootstrapMutationPagePort {
  constructor(private readonly repository = new PostgresWorkspaceMutationRepository()) {}

  async readDensePage(
    transaction: TenantTransaction,
    input: Parameters<BootstrapMutationPagePort["readDensePage"]>[1],
  ) {
    if (input.cursor !== null && input.cursor !== expectedCursor(input.fromServerRevisionExclusive)) {
      throw new TypeError("bootstrap mutation cursor conflicts with the landed revision");
    }
    const end = Math.min(input.throughServerRevisionInclusive, input.fromServerRevisionExclusive + input.pageLimit);
    const mutations = await this.repository.readRange(transaction, input.fromServerRevisionExclusive, end);
    if (mutations.length !== end - input.fromServerRevisionExclusive ||
      mutations.some((mutation, index) => mutation.serverRevision !== input.fromServerRevisionExclusive + index + 1)) {
      throw new TypeError("bootstrap mutation page is not dense");
    }
    const nextCursor = end === input.throughServerRevisionInclusive ? null : expectedCursor(end);
    const draft = {
      schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
      workspaceId: transaction.scope.workspaceId,
      fromServerRevisionExclusive: input.fromServerRevisionExclusive,
      throughServerRevisionInclusive: input.throughServerRevisionInclusive,
      mutations,
      returnedThroughServerRevision: end,
      nextCursor,
      pageDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    };
    return mutationPageSchema.parse({
      ...draft,
      pageDigest: createHash("sha256").update(encodeMutationPageDigestInput(draft)).digest("base64url"),
    });
  }
}

function expectedCursor(revision: number): string | null {
  return revision === 0 ? null : Buffer.from(`bootstrap:${revision}`, "utf8").toString("base64url");
}
