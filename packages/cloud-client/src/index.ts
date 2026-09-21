import {
  ACCOUNT_ACTIVATION_OPERATION_ID,
  BILLING_CHECKOUT_CREATE_OPERATION_ID,
  BILLING_FIXED_TERM_CONFIRM_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID,
  BILLING_SCHEMA_VERSION,
  BILLING_STATUS_READ_OPERATION_ID,
  BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID,
  accountActivationRequestSchema,
  accountActivationResponseSchema,
  billingApprovalSchema,
  billingCheckoutCreateRequestSchema,
  billingCheckoutCreateResponseSchema,
  billingFixedTermConfirmRequestSchema,
  billingFixedTermConfirmResponseSchema,
  billingFirstPurchaseRefundRequestResponseSchema,
  billingFirstPurchaseRefundRequestSchema,
  billingFirstPurchaseRefundStatusReadRequestSchema,
  billingFirstPurchaseRefundStatusReadResponseSchema,
  billingStatusReadRequestSchema,
  billingStatusReadResponseSchema,
  billingSubscriptionCancelRequestSchema,
  billingSubscriptionCancelResponseSchema,
  type AccountActivationResponse,
  type BillingApproval,
  type BillingCheckoutCreateResponse,
  type BillingFixedTermConfirmResponse,
  type BillingFirstPurchaseRefundRequestResponse,
  type BillingFirstPurchaseRefundStatusReadResponse,
  type BillingStatusReadResponse,
  type BillingSubscriptionCancelResponse,
} from "@gooddealer/protocol/account";
import {
  DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID,
  DESKTOP_AUTHORIZATION_GRANT_SCHEMA_VERSION,
  desktopAuthorizationGrantRequestSchema,
  desktopAuthorizationGrantSchema,
  type DesktopAuthorizationGrant,
} from "@gooddealer/protocol/devices";
import {
  DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID,
  WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID,
  WORKSPACE_SYNC_PULL_OPERATION_ID,
  WORKSPACE_SYNC_PUSH_OPERATION_ID,
  WORKSPACE_SYNC_SCHEMA_VERSION,
  workspaceCheckpointReadRequestSchema,
  workspaceCheckpointReadResponseSchema,
  workspaceRebootstrapRequestSchema,
  rebootstrapPlanSchema,
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
  type RebootstrapPlan,
  type WorkspacePortfolioReadResponse,
} from "@gooddealer/protocol/workspace";

export {
  ACCOUNT_ACTIVATION_OPERATION_ID,
  BILLING_CHECKOUT_CREATE_OPERATION_ID,
  BILLING_FIXED_TERM_CONFIRM_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID,
  BILLING_STATUS_READ_OPERATION_ID,
  BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID,
  DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID,
  DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID,
  WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID,
  WORKSPACE_SYNC_PULL_OPERATION_ID,
  WORKSPACE_SYNC_PUSH_OPERATION_ID,
};

export const CLOUD_OPERATION_IDS = [
  ACCOUNT_ACTIVATION_OPERATION_ID,
  BILLING_CHECKOUT_CREATE_OPERATION_ID,
  BILLING_FIXED_TERM_CONFIRM_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID,
  BILLING_STATUS_READ_OPERATION_ID,
  BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID,
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

export class BillingClient {
  public constructor(private readonly transport: CloudTransport) {}

  public async createCheckout(value: unknown): Promise<BillingCheckoutCreateResponse> {
    const request = billingCheckoutCreateRequestSchema.parse(value);
    const response = billingCheckoutCreateResponseSchema.parse(
      await this.transport.send(BILLING_CHECKOUT_CREATE_OPERATION_ID, request),
    );
    if (
      response.requestId !== request.requestId
      || response.provider !== request.provider
      || response.offer !== request.offer
    ) {
      throw new TypeError("billing checkout response does not match the request");
    }
    return response;
  }

  public async readStatus(): Promise<BillingStatusReadResponse> {
    const request = billingStatusReadRequestSchema.parse({});
    return billingStatusReadResponseSchema.parse(
      await this.transport.send(BILLING_STATUS_READ_OPERATION_ID, request),
    );
  }

  public async recoverPendingCheckout(value: unknown): Promise<BillingCheckoutCreateResponse> {
    const status = billingStatusReadResponseSchema.parse(value);
    if (
      (status.state !== "creation_unknown" && status.state !== "approval_pending")
      || status.retryMode !== "same_request"
    ) {
      throw new TypeError("billing status does not describe a recoverable checkout");
    }
    const response = await this.createCheckout({
      schemaVersion: BILLING_SCHEMA_VERSION,
      requestId: status.requestId,
      provider: status.provider,
      offer: status.offer,
      campaignCode: status.campaignCode,
    });
    if (response.checkoutId !== status.checkoutId) {
      throw new TypeError("recovered billing checkout does not match the pending status");
    }
    return response;
  }

  /** Returns a same-origin GoodDealer path; Provider URLs never enter client state. */
  public approvalPath(value: unknown): string {
    const approval: BillingApproval = billingApprovalSchema.parse(value);
    return `/billing/approval/${approval.handle}`;
  }

  public async confirmFixedTerm(value: unknown): Promise<BillingFixedTermConfirmResponse> {
    const request = billingFixedTermConfirmRequestSchema.parse(value);
    const response = billingFixedTermConfirmResponseSchema.parse(
      await this.transport.send(BILLING_FIXED_TERM_CONFIRM_OPERATION_ID, request),
    );
    if (response.requestId !== request.requestId || response.checkoutId !== request.checkoutId) {
      throw new TypeError("fixed-term confirmation response does not match the request");
    }
    return response;
  }

  public async cancelSubscription(value: unknown): Promise<BillingSubscriptionCancelResponse> {
    const request = billingSubscriptionCancelRequestSchema.parse(value);
    const response = billingSubscriptionCancelResponseSchema.parse(
      await this.transport.send(BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID, request),
    );
    if (response.requestId !== request.requestId) {
      throw new TypeError("billing cancellation response does not match the request");
    }
    return response;
  }

  public async requestFirstPurchaseRefund(value: unknown): Promise<BillingFirstPurchaseRefundRequestResponse> {
    const request = billingFirstPurchaseRefundRequestSchema.parse(value);
    const response = billingFirstPurchaseRefundRequestResponseSchema.parse(
      await this.transport.send(BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID, request),
    );
    if (response.state !== "rejected" && response.purchaseId !== request.purchaseId) {
      throw new TypeError("first-purchase refund response does not match the request");
    }
    return response;
  }

  public async readFirstPurchaseRefundStatus(value: unknown): Promise<BillingFirstPurchaseRefundStatusReadResponse> {
    const request = billingFirstPurchaseRefundStatusReadRequestSchema.parse(value);
    const response = billingFirstPurchaseRefundStatusReadResponseSchema.parse(
      await this.transport.send(BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID, request),
    );
    if (response.refundRequestId !== request.refundRequestId) {
      throw new TypeError("first-purchase refund status does not match the request");
    }
    return response;
  }
}

/** Fetches wire input for Host verification; it does not verify the lease signature itself. */
export class DesktopAuthorizationClient {
  public constructor(private readonly transport: CloudTransport) {}

  public async issue(): Promise<DesktopAuthorizationGrant> {
    const request = desktopAuthorizationGrantRequestSchema.parse({
      schemaVersion: DESKTOP_AUTHORIZATION_GRANT_SCHEMA_VERSION,
    });
    return desktopAuthorizationGrantSchema.parse(
      await this.transport.send(DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID, request),
    );
  }
}

export class WorkspaceSyncClient {
  public constructor(private readonly transport: CloudTransport) {}

  public async push(mutations: unknown): Promise<WorkspaceMutationPushResponse> {
    const request = workspaceMutationPushRequestSchema.parse({
      schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
      mutations,
    });
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
    const request = workspaceCheckpointReadRequestSchema.parse({
      schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION,
    });
    return workspaceCheckpointReadResponseSchema.parse(
      await this.transport.send(WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID, request),
    );
  }

  public async readRebootstrapPlan(): Promise<RebootstrapPlan | null> {
    const request = workspaceRebootstrapRequestSchema.parse({ schemaVersion: WORKSPACE_SYNC_SCHEMA_VERSION });
    return rebootstrapPlanSchema.nullable().parse(
      await this.transport.send(DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID, request),
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
