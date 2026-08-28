import { createHash } from "node:crypto";

import { computeDomainAssetEntityDigests } from "@gooddealer/protocol/workspace";

import type { TenantTransaction } from "../../../../db/index";
import type { BootstrapProjectionDigestPort } from "../../../devices/bootstrap-persistence-ports";
import type { WorkspaceRevisionQueryPort } from "../../revisions/index";
import { PostgresPortfolioRepository } from "./postgres-repository";

/** Portfolio-owned final digest boundary; the frozen head must still equal the requested target. */
export class PostgresBootstrapProjectionDigestPort implements BootstrapProjectionDigestPort {
  constructor(private readonly dependencies: {
    readonly revisions: WorkspaceRevisionQueryPort;
    readonly repository?: PostgresPortfolioRepository;
  }) {}

  async readEntityDigestsAt(
    transaction: TenantTransaction,
    input: Parameters<BootstrapProjectionDigestPort["readEntityDigestsAt"]>[1],
  ) {
    const head = await this.dependencies.revisions.read(transaction);
    if (head === null || head.serverRevision !== input.throughServerRevisionInclusive ||
      head.workspaceSchemaVersion !== input.workspaceSchemaVersion) {
      throw new TypeError("bootstrap projection target is no longer frozen");
    }
    const rows = await (this.dependencies.repository ?? new PostgresPortfolioRepository())
      .captureSnapshot(transaction);
    return computeDomainAssetEntityDigests(rows, async (bytes) => createHash("sha256").update(bytes).digest());
  }
}
