import {
  accountActivationRequestSchema,
  accountActivationResponseSchema,
  type AccountActivationResponse,
} from "@gooddealer/protocol/account";
import {
  workspacePortfolioReadRequestSchema,
  workspacePortfolioReadResponseSchema,
  type WorkspacePortfolioReadResponse,
} from "@gooddealer/protocol/workspace";

export const ACCOUNT_ACTIVATION_OPERATION_ID = "account.activation.activate" as const;
export const DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID = "sync.domain_asset_replica.recover" as const;

export const CLOUD_OPERATION_IDS = [
  ACCOUNT_ACTIVATION_OPERATION_ID,
  DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID,
] as const;

export type CloudOperationId = (typeof CLOUD_OPERATION_IDS)[number];

/** A logical-operation transport. It grants no route, network, credential, or tenant authority. */
export interface CloudTransport {
  send(operationId: CloudOperationId, payload: unknown): Promise<unknown>;
}

export class AccountActivationClient {
  public constructor(private readonly transport: CloudTransport) {}

  public async activate(): Promise<AccountActivationResponse> {
    const request = accountActivationRequestSchema.parse({ schemaVersion: 1 });
    return accountActivationResponseSchema.parse(
      await this.transport.send(ACCOUNT_ACTIVATION_OPERATION_ID, request),
    );
  }
}

/**
 * Reads a sanitized Cloud replica only as recovery input. Desktop must validate and merge the
 * result into local SQLCipher before any business Query can observe it.
 */
export class DomainAssetReplicaRecoveryClient {
  public constructor(private readonly transport: CloudTransport) {}

  public async read(): Promise<WorkspacePortfolioReadResponse> {
    const request = workspacePortfolioReadRequestSchema.parse({});
    return workspacePortfolioReadResponseSchema.parse(
      await this.transport.send(DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID, request),
    );
  }
}
