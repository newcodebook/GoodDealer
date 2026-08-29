import {
  ACCOUNT_ACTIVATION_OPERATION_ID,
  accountActivationRequestSchema,
  accountActivationResponseSchema,
  type AccountActivationResponse,
} from "@gooddealer/protocol/account";
import {
  DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID,
  desktopAuthorizationGrantRequestSchema,
  desktopAuthorizationGrantSchema,
  type DesktopAuthorizationGrant,
} from "@gooddealer/protocol/devices";
import {
  DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID,
  WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID,
  WORKSPACE_SYNC_PULL_OPERATION_ID,
  WORKSPACE_SYNC_PUSH_OPERATION_ID,
  workspaceCheckpointReadRequestSchema,
  workspaceCheckpointReadResponseSchema,
  workspaceMutationPullRequestSchema,
  workspaceMutationPullResponseSchema,
  workspaceMutationPushRequestSchema,
  workspaceMutationPushResponseSchema,
  workspacePortfolioReadRequestSchema,
  workspacePortfolioReadResponseSchema,
  type TenantNeutralSubmittedSyncMutation,
  type WorkspaceCheckpointReadResponse,
  type WorkspaceMutationPullRequest,
  type WorkspaceMutationPullResponse,
  type WorkspaceMutationPushResponse,
  type WorkspacePortfolioReadResponse,
} from "@gooddealer/protocol/workspace";

export {
  ACCOUNT_ACTIVATION_OPERATION_ID,
  DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID,
  DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID,
  WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID,
  WORKSPACE_SYNC_PULL_OPERATION_ID,
  WORKSPACE_SYNC_PUSH_OPERATION_ID,
};

export const CLOUD_OPERATION_IDS = [
  ACCOUNT_ACTIVATION_OPERATION_ID,
  DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID,
  WORKSPACE_SYNC_PUSH_OPERATION_ID,
  WORKSPACE_SYNC_PULL_OPERATION_ID,
  WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID,
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

/** Fetches wire input for Host verification; it does not verify the lease signature itself. */
export class DesktopAuthorizationClient {
  public constructor(private readonly transport: CloudTransport) {}

  public async issue(): Promise<DesktopAuthorizationGrant> {
    const request = desktopAuthorizationGrantRequestSchema.parse({ schemaVersion: 1 });
    return desktopAuthorizationGrantSchema.parse(
      await this.transport.send(DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID, request),
    );
  }
}

export class WorkspaceSyncClient {
  public constructor(private readonly transport: CloudTransport) {}

  public async push(mutations: unknown): Promise<WorkspaceMutationPushResponse> {
    const request = workspaceMutationPushRequestSchema.parse({ schemaVersion: 1, mutations });
    const response = workspaceMutationPushResponseSchema.parse(
      await this.transport.send(WORKSPACE_SYNC_PUSH_OPERATION_ID, request),
    );
    if (response.accepted) {
      if (response.acknowledgements.length !== request.mutations.length) {
        throw new TypeError("mutation acknowledgements do not match the submitted batch");
      }
      for (let index = 0; index < request.mutations.length; index += 1) {
        const mutation = request.mutations[index]!;
        const acknowledgement = response.acknowledgements[index]!;
        if (
          acknowledgement.mutationId !== mutation.mutationId ||
          acknowledgement.deviceMutationSequence !== mutation.deviceMutationSequence
        ) {
          throw new TypeError("mutation acknowledgements do not match the submitted batch");
        }
      }
    }
    return response;
  }

  public async pull(requestValue: unknown): Promise<WorkspaceMutationPullResponse> {
    const request: WorkspaceMutationPullRequest = workspaceMutationPullRequestSchema.parse(requestValue);
    const response = workspaceMutationPullResponseSchema.parse(
      await this.transport.send(WORKSPACE_SYNC_PULL_OPERATION_ID, request),
    );
    if (
      response.accepted &&
      response.page.fromServerRevisionExclusive !== request.afterServerRevision
    ) {
      throw new TypeError("mutation page does not continue the requested revision");
    }
    return response;
  }

  public async readCheckpoint(): Promise<WorkspaceCheckpointReadResponse> {
    const request = workspaceCheckpointReadRequestSchema.parse({ schemaVersion: 1 });
    return workspaceCheckpointReadResponseSchema.parse(
      await this.transport.send(WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID, request),
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

export type { TenantNeutralSubmittedSyncMutation };
