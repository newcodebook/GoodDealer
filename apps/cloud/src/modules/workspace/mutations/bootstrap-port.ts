import { createHash } from "node:crypto";

import {
  WORKSPACE_SYNC_MUTATION_SCHEMA_VERSION,
  encodeMutationPageDigestInput,
  mutationPageSchema,
} from "@gooddealer/protocol/workspace";

import { DEVICE_BOOTSTRAP_INSTALLATION_LIMITS } from "@gooddealer/protocol/devices";

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
    const requestedEnd = Math.min(input.throughServerRevisionInclusive, input.fromServerRevisionExclusive + input.pageLimit);
    const candidates = await this.repository.readRange(transaction, input.fromServerRevisionExclusive, requestedEnd);
    if (candidates.length !== requestedEnd - input.fromServerRevisionExclusive ||
      candidates.some((mutation, index) => mutation.serverRevision !== input.fromServerRevisionExclusive + index + 1)) {
      throw new TypeError("bootstrap mutation page is not dense");
    }
    // Keep a dense prefix. A count-only limit can exceed the HTTP/receipt byte budget.
    let bytes = 2;
    const mutations = [];
    for (const mutation of candidates) {
      const size = Buffer.byteLength(JSON.stringify(mutation), "utf8") + 1;
      if (bytes + size > DEVICE_BOOTSTRAP_INSTALLATION_LIMITS.pageDataBytes) break;
      mutations.push(mutation); bytes += size;
    }
    if (candidates.length > 0 && mutations.length === 0) throw new TypeError("bootstrap mutation exceeds page budget");
    const end = input.fromServerRevisionExclusive + mutations.length;
    const nextCursor = end === input.throughServerRevisionInclusive ? null : expectedCursor(end);
    const draft = {
      schemaVersion: WORKSPACE_SYNC_MUTATION_SCHEMA_VERSION,
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
