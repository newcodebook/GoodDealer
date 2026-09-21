import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ACCOUNT_ACTIVATION_OPERATION_ID,
  AccountActivationClient,
  BILLING_CHECKOUT_CREATE_OPERATION_ID,
  BILLING_FIXED_TERM_CONFIRM_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID,
  BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID,
  BILLING_STATUS_READ_OPERATION_ID,
  BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID,
  BillingClient,
  CLOUD_OPERATION_IDS,
  DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID,
  DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID,
  DesktopAuthorizationClient,
  DomainAssetReplicaRecoveryClient,
  WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID,
  WORKSPACE_SYNC_PULL_OPERATION_ID,
  WORKSPACE_SYNC_PUSH_OPERATION_ID,
  WorkspaceSyncClient,
  type CloudOperationId,
  type CloudTransport,
} from "../src/index";

const activeDeviceLease = {
  schemaVersion: 1,
  typ: "gd.active-device-lease.v1",
  iss: "https://accounts.gooddealer.com",
  aud: "gooddealer-desktop/active-device-lease",
  kid: "lease-key-1",
  accountId: "account-1",
  deviceId: "device-1",
  accountSecurityEpoch: 1,
  jti: "lease-1",
  issuedAt: "2026-08-29T10:00:00Z",
  expiresAt: "2026-08-30T10:00:00Z",
  payload: {
    leaseEpoch: 1,
    renewAfter: "2026-08-29T10:05:00Z",
    onlineExpiresAt: "2026-08-29T10:15:00Z",
    offlineExecuteUntil: "2026-08-30T10:00:00Z",
  },
  signature: "c2lnbmF0dXJl",
} as const;

const mutation = {
  schemaVersion: 2,
  mutationId: "mutation-1",
  workspaceSchemaVersion: 1,
  entityType: "domain_asset",
  entityId: "example.test",
  operationKind: "upsert",
  baseServerRevision: 0,
  changedFields: [{ fieldPath: "note", value: "local note" }],
  sourceDeviceId: "device-1",
  activeLeaseEpoch: 1,
  deviceMutationSequence: 1,
} as const;

const mutationPage = {
  schemaVersion: 2,
  workspaceId: "workspace-1",
  fromServerRevisionExclusive: 0,
  throughServerRevisionInclusive: 1,
  mutations: [{ ...mutation, workspaceId: "workspace-1", serverRevision: 1 }],
  returnedThroughServerRevision: 1,
  nextCursor: null,
  pageDigest: "A".repeat(43),
} as const;

const checkpoint = {
  schemaVersion: 2,
  checkpointId: "checkpoint-1",
  workspaceId: "workspace-1",
  workspaceSchemaVersion: 1,
  throughServerRevision: 1,
  checkpointDigest: "B".repeat(43),
} as const;

const portfolioResponse = {
  schemaVersion: 1,
  assets: [],
  projection: {
    materializedThroughServerRevision: 1,
    materializedAt: "2026-08-29T10:00:00Z",
    projectionAvailability: "available",
    projectionEvidenceStatus: "confirmed",
  },
} as const;

const approval = {
  kind: "gooddealer_redirect",
  handle: "A".repeat(43),
  expiresAt: "2026-09-02T16:00:00Z",
} as const;

const refundRequest = {
  schemaVersion: 1 as const,
  requestId: "refund-idempotency-1",
  purchaseId: "purchase-1",
};

const refundPending = {
  schemaVersion: 1 as const,
  state: "refund_pending" as const,
  refundRequestId: "refund-request-1",
  purchaseId: refundRequest.purchaseId,
  commercialAccess: "read_only" as const,
  requestedAmount: { minor: 980, currency: "USD" as const },
  retryable: false,
  retryAfter: null,
};

function responses(): Record<CloudOperationId, unknown> {
  return {
    [ACCOUNT_ACTIVATION_OPERATION_ID]: { schemaVersion: 1, state: "active" },
    [BILLING_CHECKOUT_CREATE_OPERATION_ID]: {
      schemaVersion: 1,
      requestId: "billing-request-1",
      checkoutId: "checkout-1",
      provider: "stripe",
      offer: "annual",
      approval,
    },
    [BILLING_FIXED_TERM_CONFIRM_OPERATION_ID]: {
      schemaVersion: 1,
      state: "processing",
      requestId: "capture-request-1",
      checkoutId: "checkout-1",
    },
    [BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID]: refundPending,
    [BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID]: refundPending,
    [BILLING_STATUS_READ_OPERATION_ID]: {
      schemaVersion: 1,
      state: "active",
      provider: "stripe",
      offer: "annual",
      purchaseId: "checkout-1",
      paidThrough: "2027-08-29T10:00:00Z",
      refundEligibleUntil: null,
    },
    [BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID]: {
      schemaVersion: 1,
      state: "cancel_at_period_end",
      requestId: "cancel-request-1",
      paidThrough: "2027-08-29T10:00:00Z",
    },
    [DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID]: {
      schemaVersion: 3,
      typ: "gd.desktop-authorization-grant.v3",
      iss: "https://accounts.gooddealer.com",
      aud: "gooddealer-desktop/local-business",
      kid: "grant-key-1",
      issuedAt: activeDeviceLease.issuedAt,
      expiresAt: activeDeviceLease.expiresAt,
      workspace: { workspaceId: "workspace-1", kind: "personal_default" },
      activeDeviceLease,
      scopes: ["workspace:mutate", "workspace:read"],
      commercialAuthority: {
        schemaVersion: 1,
        entitlementRevision: 2,
        entitlementProjectionDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        state: "active",
        commercialExpiresAt: "2027-08-29T10:00:00Z",
        capability: "cloudflare:dns:observe",
      },
      signature: "c2lnbmF0dXJl",
    },
    [WORKSPACE_SYNC_PUSH_OPERATION_ID]: {
      schemaVersion: 2,
      accepted: true,
      acknowledgements: [{
        mutationId: "mutation-1",
        deviceMutationSequence: 1,
        serverRevision: 1,
        duplicate: false,
      }],
      headServerRevision: 1,
    },
    [WORKSPACE_SYNC_PULL_OPERATION_ID]: {
      schemaVersion: 2,
      accepted: true,
      confirmedThrough: 0,
      pendingDelivery: {
        generation: 1,
        fromServerRevisionExclusive: 0,
        throughServerRevisionInclusive: 1,
        targetServerRevision: 1,
        pageDigest: "A".repeat(43),
        nextCursorDigest: null,
        predecessorConfirmationDigest: null,
        expiresAt: "2026-08-29T10:15:00Z",
      },
      confirmToken: "confirm-token-1",
      page: mutationPage,
    },
    [WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID]: { schemaVersion: 2, checkpoint },
    [DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID]: portfolioResponse,
  };
}

describe("Cloud control-plane and sync clients", () => {
  it("freezes the first-slice operation surface without normal Cloud queries or Provider operations", () => {
    expect(CLOUD_OPERATION_IDS).toEqual([
      "account.activation.activate",
      "account.billing.checkout.create",
      "account.billing.fixedTerm.confirm",
      "account.billing.firstPurchaseRefund.request",
      "account.billing.firstPurchaseRefund.status.read",
      "account.billing.status.read",
      "account.billing.subscription.cancel",
      "devices.authorizationGrant.issue",
      "workspace.sync.mutations.push",
      "workspace.sync.mutations.pull",
      "workspace.sync.checkpoint.read",
      "workspace.sync.domainAssetReplica.recover",
    ]);
    expectTypeOf<CloudOperationId>().toEqualTypeOf<
      | "account.activation.activate"
      | "account.billing.checkout.create"
      | "account.billing.fixedTerm.confirm"
      | "account.billing.firstPurchaseRefund.request"
      | "account.billing.firstPurchaseRefund.status.read"
      | "account.billing.status.read"
      | "account.billing.subscription.cancel"
      | "devices.authorizationGrant.issue"
      | "workspace.sync.mutations.push"
      | "workspace.sync.mutations.pull"
      | "workspace.sync.checkpoint.read"
      | "workspace.sync.domainAssetReplica.recover"
    >();
    expect(JSON.stringify(CLOUD_OPERATION_IDS)).not.toMatch(/cloudflare|portfolio\.read|observation/iu);
  });

  it("constructs exact tenant-neutral control, sync, checkpoint, and recovery payloads", async () => {
    const calls: Array<{ operationId: CloudOperationId; payload: unknown }> = [];
    const operationResponses = responses();
    const transport: CloudTransport = {
      async send(operationId, payload) {
        calls.push({ operationId, payload });
        return operationResponses[operationId];
      },
    };

    await new AccountActivationClient(transport).activate();
    const billing = new BillingClient(transport);
    await billing.createCheckout({
      schemaVersion: 1,
      requestId: "billing-request-1",
      provider: "stripe",
      offer: "annual",
      campaignCode: null,
    });
    await billing.confirmFixedTerm({
      schemaVersion: 1,
      requestId: "capture-request-1",
      checkoutId: "checkout-1",
    });
    await billing.readStatus();
    await billing.cancelSubscription({ schemaVersion: 1, requestId: "cancel-request-1" });
    await new DesktopAuthorizationClient(transport).issue();
    const sync = new WorkspaceSyncClient(transport);
    await sync.push([mutation]);
    await sync.pull({ schemaVersion: 2, afterServerRevision: 0, cursor: null, pageLimit: 64, confirm: null });
    await sync.readCheckpoint();
    await new DomainAssetReplicaRecoveryClient(transport).read();

    expect(calls).toEqual([
      { operationId: ACCOUNT_ACTIVATION_OPERATION_ID, payload: { schemaVersion: 1 } },
      {
        operationId: BILLING_CHECKOUT_CREATE_OPERATION_ID,
        payload: {
          schemaVersion: 1,
          requestId: "billing-request-1",
          provider: "stripe",
          offer: "annual",
          campaignCode: null,
        },
      },
      {
        operationId: BILLING_FIXED_TERM_CONFIRM_OPERATION_ID,
        payload: { schemaVersion: 1, requestId: "capture-request-1", checkoutId: "checkout-1" },
      },
      { operationId: BILLING_STATUS_READ_OPERATION_ID, payload: {} },
      {
        operationId: BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID,
        payload: { schemaVersion: 1, requestId: "cancel-request-1" },
      },
      { operationId: DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID, payload: { schemaVersion: 3 } },
      { operationId: WORKSPACE_SYNC_PUSH_OPERATION_ID, payload: { schemaVersion: 2, mutations: [mutation] } },
      {
        operationId: WORKSPACE_SYNC_PULL_OPERATION_ID,
        payload: { schemaVersion: 2, afterServerRevision: 0, cursor: null, pageLimit: 64, confirm: null },
      },
      { operationId: WORKSPACE_SYNC_CHECKPOINT_OPERATION_ID, payload: { schemaVersion: 2 } },
      { operationId: DOMAIN_ASSET_REPLICA_RECOVERY_OPERATION_ID, payload: {} },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(
      /accountId|workspaceId|token|credential|connectionId|providerAccountId|url|headers|method/iu,
    );
    expect(billing.approvalPath(approval)).toBe(`/billing/approval/${"A".repeat(43)}`);
  });

  it("fails closed on tenant or secret injection into client inputs", async () => {
    const sync = new WorkspaceSyncClient({ async send() { throw new Error("must not send"); } });
    await expect(sync.push([{ ...mutation, workspaceId: "workspace-1" }])).rejects.toThrow();
    await expect(sync.push([{ ...mutation, accessToken: "secret" }])).rejects.toThrow();
    await expect(sync.pull({
      schemaVersion: 2,
      afterServerRevision: 0,
      cursor: null,
      pageLimit: 64,
      confirm: null,
      workspaceId: "workspace-1",
    })).rejects.toThrow();

    let billingCalls = 0;
    const billing = new BillingClient({ async send() { billingCalls += 1; return null; } });
    await expect(billing.createCheckout({
      schemaVersion: 1,
      requestId: "billing-request-1",
      provider: "stripe",
      offer: "annual",
      campaignCode: null,
      approvalUrl: "https://provider.example/resource",
    })).rejects.toThrow();
    await expect(billing.cancelSubscription({
      schemaVersion: 1,
      requestId: "cancel-request-1",
      subscriptionId: "provider-subscription",
    })).rejects.toThrow();
    await expect(billing.confirmFixedTerm({
      schemaVersion: 1,
      requestId: "capture-request-1",
      checkoutId: "checkout-1",
      orderId: "provider-order",
    })).rejects.toThrow();
    expect(billingCalls).toBe(0);
  });

  it("fails closed on malformed responses and request/response correlation mismatches", async () => {
    for (const mismatch of [
      { requestId: "other-request" },
      { provider: "paypal" },
      { offer: "monthly" },
    ]) {
      await expect(new BillingClient({
        async send() {
          return {
            ...responses()[BILLING_CHECKOUT_CREATE_OPERATION_ID] as object,
            ...mismatch,
          };
        },
      }).createCheckout({
        schemaVersion: 1,
        requestId: "billing-request-1",
        provider: "stripe",
        offer: "annual",
        campaignCode: null,
      })).rejects.toThrow("does not match");
    }

    await expect(new DesktopAuthorizationClient({
      async send() {
        return {
          ...responses()[DESKTOP_AUTHORIZATION_GRANT_OPERATION_ID] as object,
          providerAccountId: "provider-account",
        };
      },
    }).issue()).rejects.toThrow();

    await expect(new WorkspaceSyncClient({
      async send() {
        return {
          ...responses()[WORKSPACE_SYNC_PUSH_OPERATION_ID] as object,
          acknowledgements: [{
            mutationId: "different-mutation",
            deviceMutationSequence: 1,
            serverRevision: 1,
            duplicate: false,
          }],
        };
      },
    }).push([mutation])).rejects.toThrow("acknowledgements do not match");

    await expect(new WorkspaceSyncClient({
      async send() {
        return {
          schemaVersion: 1,
          accepted: true,
          page: { ...mutationPage, fromServerRevisionExclusive: 1 },
        };
      },
    }).pull({ schemaVersion: 2, afterServerRevision: 0, cursor: null, pageLimit: 64, confirm: null }))
      .rejects.toThrow();

    await expect(new DomainAssetReplicaRecoveryClient({
      async send() {
        return { ...portfolioResponse, workspaceId: "workspace-1" };
      },
    }).read()).rejects.toThrow();

    const forbiddenBillingFields = [
      "providerCheckoutId",
      "providerCommercialId",
      "providerResourceId",
      "subscriptionId",
      "orderId",
      "captureId",
      "providerItemId",
      "priceId",
      "planId",
      "customerId",
      "paymentMethodId",
      "payerId",
      "accountId",
      "approvalUrl",
      "providerUrl",
      "checkoutUrl",
      "payer",
      "card",
      "cardNumber",
      "cvc",
      "clientSecret",
      "credential",
      "authorization",
      "headers",
    ] as const;
    for (const field of forbiddenBillingFields) {
      await expect(new BillingClient({
        async send() {
          return {
            ...responses()[BILLING_CHECKOUT_CREATE_OPERATION_ID] as object,
            [field]: "provider-resource",
          };
        },
      }).createCheckout({
        schemaVersion: 1,
        requestId: "billing-request-1",
        provider: "stripe",
        offer: "annual",
        campaignCode: null,
      })).rejects.toThrow();

      await expect(new BillingClient({
        async send() {
          return {
            ...responses()[BILLING_CHECKOUT_CREATE_OPERATION_ID] as object,
            approval: { ...approval, [field]: "provider-resource" },
          };
        },
      }).createCheckout({
        schemaVersion: 1,
        requestId: "billing-request-1",
        provider: "stripe",
        offer: "annual",
        campaignCode: null,
      })).rejects.toThrow();

      await expect(new BillingClient({
        async send() {
          return {
            ...responses()[BILLING_STATUS_READ_OPERATION_ID] as object,
            [field]: "provider-resource",
          };
        },
      }).readStatus()).rejects.toThrow();

      await expect(new BillingClient({
        async send() {
          return {
            ...responses()[BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID] as object,
            [field]: "provider-resource",
          };
        },
      }).cancelSubscription({ schemaVersion: 1, requestId: "cancel-request-1" })).rejects.toThrow();
    }

    const billing = new BillingClient({ async send() { throw new Error("must not send"); } });
    expect(() => billing.approvalPath({ ...approval, approvalUrl: "https://provider.example" })).toThrow();
    expect(() => billing.approvalPath({ ...approval, handle: "../provider" })).toThrow();

    await expect(new BillingClient({
      async send() {
        return { ...responses()[BILLING_FIXED_TERM_CONFIRM_OPERATION_ID] as object, requestId: "other" };
      },
    }).confirmFixedTerm({
      schemaVersion: 1,
      requestId: "capture-request-1",
      checkoutId: "checkout-1",
    })).rejects.toThrow(/does not match/u);

    await expect(new BillingClient({
      async send() {
        return { ...responses()[BILLING_SUBSCRIPTION_CANCEL_OPERATION_ID] as object, requestId: "other" };
      },
    }).cancelSubscription({
      schemaVersion: 1,
      requestId: "cancel-request-1",
    })).rejects.toThrow(/does not match/u);
  });

  it("recovers creation-unknown and approval-pending only with the exact checkout identity", async () => {
    const pending = {
      schemaVersion: 1,
      checkoutId: "checkout-1",
      requestId: "billing-request-1",
      provider: "stripe",
      offer: "annual",
      campaignCode: "LAUNCH",
      retryMode: "same_request",
      paidThrough: null,
      refundEligibleUntil: null,
    } as const;
    for (const state of ["creation_unknown", "approval_pending"] as const) {
      const calls: unknown[] = [];
      const billing = new BillingClient({
        async send(operationId, payload) {
          calls.push({ operationId, payload });
          return responses()[BILLING_CHECKOUT_CREATE_OPERATION_ID];
        },
      });
      await expect(billing.recoverPendingCheckout({ ...pending, state }))
        .resolves.toMatchObject({ checkoutId: "checkout-1" });
      expect(calls).toEqual([{
        operationId: BILLING_CHECKOUT_CREATE_OPERATION_ID,
        payload: {
          schemaVersion: 1,
          requestId: "billing-request-1",
          provider: "stripe",
          offer: "annual",
          campaignCode: "LAUNCH",
        },
      }]);
    }

    await expect(new BillingClient({
      async send() { throw new Error("must not send"); },
    }).recoverPendingCheckout({
      schemaVersion: 1,
      state: "active",
      provider: "stripe",
      offer: "annual",
      purchaseId: "checkout-1",
      paidThrough: "2027-08-29T10:00:00Z",
      refundEligibleUntil: null,
    })).rejects.toThrow(/recoverable/u);

    await expect(new BillingClient({
      async send() {
        return { ...responses()[BILLING_CHECKOUT_CREATE_OPERATION_ID] as object, checkoutId: "checkout-other" };
      },
    }).recoverPendingCheckout({ ...pending, state: "creation_unknown" })).rejects.toThrow(/does not match/u);
  });

  it("accepts fresh GoodDealer handles from exact confirmed-pending replay", async () => {
    let issuance = 0;
    const billing = new BillingClient({
      async send() {
        issuance += 1;
        return {
          ...responses()[BILLING_CHECKOUT_CREATE_OPERATION_ID] as object,
          approval: {
            ...approval,
            handle: String.fromCharCode(65 + issuance).repeat(43),
          },
        };
      },
    });
    const status = {
      schemaVersion: 1,
      state: "approval_pending",
      checkoutId: "checkout-1",
      requestId: "billing-request-1",
      provider: "stripe",
      offer: "annual",
      campaignCode: null,
      retryMode: "same_request",
      paidThrough: null,
      refundEligibleUntil: null,
    } as const;
    const first = await billing.recoverPendingCheckout(status);
    const second = await billing.recoverPendingCheckout(status);
    expect(first.approval.handle).not.toBe(second.approval.handle);
    expect(first.checkoutId).toBe(second.checkoutId);
    expect(issuance).toBe(2);
  });

  it("constructs and correlates first-purchase refund request and status operations", async () => {
    const calls: Array<{ operationId: CloudOperationId; payload: unknown }> = [];
    const billing = new BillingClient({
      async send(operationId, payload) {
        calls.push({ operationId, payload });
        return responses()[operationId];
      },
    });
    await expect(billing.requestFirstPurchaseRefund(refundRequest)).resolves.toEqual(refundPending);
    await expect(billing.readFirstPurchaseRefundStatus({
      schemaVersion: 1,
      refundRequestId: "refund-request-1",
    })).resolves.toEqual(refundPending);
    expect(calls).toEqual([
      { operationId: BILLING_FIRST_PURCHASE_REFUND_REQUEST_OPERATION_ID, payload: refundRequest },
      {
        operationId: BILLING_FIRST_PURCHASE_REFUND_STATUS_READ_OPERATION_ID,
        payload: { schemaVersion: 1, refundRequestId: "refund-request-1" },
      },
    ]);
    await expect(new BillingClient({ async send() {
      return { ...refundPending, purchaseId: "purchase-other" };
    } }).requestFirstPurchaseRefund(refundRequest)).rejects.toThrow(/does not match/u);
    await expect(new BillingClient({ async send() {
      return { ...refundPending, refundRequestId: "refund-request-other" };
    } }).readFirstPurchaseRefundStatus({
      schemaVersion: 1, refundRequestId: "refund-request-1",
    })).rejects.toThrow(/does not match/u);
  });

  it("rejects refund responses whose retry presentation contradicts aggregate truth", async () => {
    const nonRetryStates = [
      "termination_pending",
      "termination_unknown",
      "refund_pending",
      "refund_unknown",
      "manual_resolution",
    ] as const;
    for (const state of nonRetryStates) {
      const malformed = { ...refundPending, state, retryable: true };
      const billing = new BillingClient({ async send() { return malformed; } });
      await expect(billing.requestFirstPurchaseRefund(refundRequest)).rejects.toThrow();
      await expect(billing.readFirstPurchaseRefundStatus({
        schemaVersion: 1, refundRequestId: refundPending.refundRequestId,
      })).rejects.toThrow();
    }
    for (const malformed of [
      { ...refundPending, state: "refund_unknown", retryAfter: "2026-09-04T00:00:00Z" },
      { ...refundPending, state: "retry_wait", retryable: false, retryAfter: "2026-09-04T00:00:00Z" },
      { ...refundPending, state: "retry_wait", retryable: true, retryAfter: null },
      {
        ...refundPending,
        state: "refunded",
        retryable: true,
        completedAt: "2026-09-03T12:00:00Z",
      },
    ]) {
      await expect(new BillingClient({ async send() { return malformed; } })
        .requestFirstPurchaseRefund(refundRequest)).rejects.toThrow();
    }
  });
});
