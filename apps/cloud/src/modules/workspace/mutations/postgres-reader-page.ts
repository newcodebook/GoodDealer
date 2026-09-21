import { createHash } from "node:crypto";

import {
  WORKSPACE_SYNC_SCHEMA_VERSION,
  encodeMutationPageDigestInput,
  mutationPageSchema,
} from "@gooddealer/protocol/workspace";

import type { TenantTransaction } from "../../../db/index";
import type { ReaderMutationPageQueryPort } from "../cursors/postgres-reader-cursor-service";
import { PostgresWorkspaceMutationRepository } from "./postgres-repository";

/** Mutation-owned dense page adapter for the durable reader-delivery service. */
export class PostgresReaderMutationPage implements ReaderMutationPageQueryPort {
  constructor(private readonly repository = new PostgresWorkspaceMutationRepository()) {}

  async readPage(transaction: TenantTransaction, input: {
    readonly fromServerRevisionExclusive: number;
    readonly throughServerRevisionInclusive: number;
    readonly pageLimit: number;
  }) {
    const end = Math.min(
      input.throughServerRevisionInclusive,
      input.fromServerRevisionExclusive + input.pageLimit,
    );
    const mutations = await this.repository.readRange(
      transaction,
      input.fromServerRevisionExclusive,
      end,
    );
    if (mutations.length !== end - input.fromServerRevisionExclusive
      || mutations.some((mutation, index) => mutation.serverRevision !== input.fromServerRevisionExclusive + index + 1)) {
      throw new TypeError("reader mutation page is not dense");
    }
    const draft = {
      schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
      workspaceId: transaction.scope.workspaceId,
      fromServerRevisionExclusive: input.fromServerRevisionExclusive,
      throughServerRevisionInclusive: input.throughServerRevisionInclusive,
      mutations,
      returnedThroughServerRevision: end,
      nextCursor: end === input.throughServerRevisionInclusive ? null : "pending-reader-cursor",
      pageDigest: "A".repeat(43),
    };
    return mutationPageSchema.parse({
      ...draft,
      pageDigest: createHash("sha256").update(encodeMutationPageDigestInput(draft)).digest("base64url"),
    });
  }
}
