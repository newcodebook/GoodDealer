import { accountRejectionSchema, type AccountRejectionCode } from "@gooddealer/protocol/account";
import { deviceSwitchRequestViewSchema, type DeviceBindingSummary } from "@gooddealer/protocol/devices";
import { describe, expect, it } from "vitest";

import {
  ActiveDeviceLeaseLifecycle,
  BOOTSTRAP_CAPABILITY_TTL_SECONDS,
  DRAINING_STATE_TTL_SECONDS,
  DeviceSwitchWorkflow,
  DeviceSwitchWorkflowRegistry,
  DevicesFixtureService,
  PIN_TTL_SECONDS,
  REQUESTED_STATE_TTL_SECONDS,
  TAKEOVER_CLAIM_WINDOW_SECONDS,
} from "../src/modules/devices/index";

function workflow(overrides: Partial<ConstructorParameters<typeof DeviceSwitchWorkflow>[0]> = {}): DeviceSwitchWorkflow {
  return new DeviceSwitchWorkflow({
    workflowId: "switch-1",
    accountId: "account-1",
    workspaceId: "workspace-1",
    mode: "normal",
    fromDeviceId: null,
    toDeviceId: "device-b",
    idempotencyKey: "request-key-1",
    requestedAt: "2026-08-14T08:00:00Z",
    exclusiveExecutionBlockUntil: null,
    oldLeaseOfflineExecuteUntil: null,
    workspaceHasPublishedCheckpoint: false,
    boundKeyId: "key-b",
    boundKeyVersion: 1,
    boundAccountSecurityEpoch: 1,
    ...overrides,
  });
}

function binding(
  deviceId: string,
  role: "active" | "standby" | "none",
  overrides: Partial<DeviceBindingSummary> = {},
): DeviceBindingSummary {
  return {
    schemaVersion: 1,
    deviceId,
    platform: "macos",
    displayName: deviceId,
    status: "bound",
    role,
    credentialEpoch: 1,
    signingKeyId: `key-${deviceId}`,
    signingKeyVersion: 1,
    signingKeyStatus: "active",
    boundAt: "2026-01-01T00:00:00Z",
    lastSeenAt: "2026-01-01T00:00:00Z",
    removedAt: null,
    currentDevice: false,
    ...overrides,
  };
}

function rejection(value: unknown, code: AccountRejectionCode): void {
  expect(accountRejectionSchema.parse(value).code).toBe(code);
}

describe("DeviceSwitchWorkflow", () => {
  it("P16-INV-1/2/4/5 uses one aggregate mutex and immutable initial adjudication", () => {
    const registry = new DeviceSwitchWorkflowRegistry();
    const input = workflow().snapshot();
    const first = registry.create({
      workflowId: input.workflowId,
      accountId: input.accountId,
      workspaceId: input.workspaceId,
      mode: input.mode,
      fromDeviceId: input.fromDeviceId,
      toDeviceId: input.toDeviceId,
      idempotencyKey: input.idempotencyKey,
      requestedAt: input.requestedAt,
      exclusiveExecutionBlockUntil: null,
      oldLeaseOfflineExecuteUntil: null,
      workspaceHasPublishedCheckpoint: false,
      boundKeyId: input.boundKeyId,
      boundKeyVersion: input.boundKeyVersion,
      boundAccountSecurityEpoch: input.boundAccountSecurityEpoch,
    });
    expect(first).toMatchObject({ accepted: true, replay: false });
    const replay = registry.create({
      ...(first.accepted ? first.workflow.snapshot() : input),
      exclusiveExecutionBlockUntil: null,
      oldLeaseOfflineExecuteUntil: null,
      workspaceHasPublishedCheckpoint: false,
    });
    expect(replay).toMatchObject({ accepted: true, replay: true });
    expect(registry.create({
      workflowId: "switch-2",
      accountId: "account-1",
      workspaceId: "workspace-1",
      mode: "forced",
      fromDeviceId: null,
      toDeviceId: "device-c",
      idempotencyKey: "request-key-2",
      requestedAt: "2026-08-14T08:00:01Z",
      exclusiveExecutionBlockUntil: null,
      oldLeaseOfflineExecuteUntil: null,
      workspaceHasPublishedCheckpoint: true,
      boundKeyId: "key-c",
      boundKeyVersion: 1,
      boundAccountSecurityEpoch: 1,
    })).toEqual({ accepted: false, code: "ACTIVE_DEVICE_CONFLICT" });
    expect(first.accepted && first.workflow.workflowRevision).toBe(0);
  });

  it("P16-INV-4 selects requested, draining, and waiting_expiry without client clock derivation", () => {
    expect(REQUESTED_STATE_TTL_SECONDS).toBe(24 * 60 * 60);
    expect(DRAINING_STATE_TTL_SECONDS).toBe(24 * 60 * 60);
    expect(TAKEOVER_CLAIM_WINDOW_SECONDS).toBe(24 * 60 * 60);
    expect(workflow().snapshot()).toMatchObject({
      purpose: "first_device",
      status: "requested",
      earliestTakeoverAt: null,
      stateDeadline: "2026-08-15T08:00:00Z",
    });
    expect(workflow({ fromDeviceId: "device-a" }).snapshot()).toMatchObject({
      purpose: "device_switch",
      status: "draining",
      stateDeadline: "2026-08-15T08:00:00Z",
    });
    expect(workflow({ workspaceHasPublishedCheckpoint: true }).snapshot()).toMatchObject({
      purpose: "recovery_activation",
      status: "requested",
      stateDeadline: "2026-08-15T08:00:00Z",
    });
    expect(workflow({
      mode: "forced",
      exclusiveExecutionBlockUntil: "2026-08-14T09:00:00Z",
      oldLeaseOfflineExecuteUntil: "2026-08-14T08:30:00Z",
    }).snapshot()).toMatchObject({
      purpose: "device_switch",
      status: "waiting_expiry",
      earliestTakeoverAt: "2026-08-14T09:00:00Z",
      stateDeadline: "2026-08-15T09:00:00Z",
    });
  });

  it("lets takeover win at earliestTakeoverAt and expires only at the later claim deadline", () => {
    const atTakeoverBoundary = workflow({
      mode: "forced",
      exclusiveExecutionBlockUntil: "2026-08-14T09:00:00Z",
    });
    expect(atTakeoverBoundary.expire("2026-08-14T09:00:00Z")).toBeNull();
    expect(atTakeoverBoundary.takeoverAllowed("2026-08-14T09:00:00Z")).toBe(true);
    expect(atTakeoverBoundary.enterBootstrapping({
      pendingLeaseEpoch: 1,
      capabilityJti: "capability-1",
      now: "2026-08-14T09:00:00Z",
    }).status).toBe("bootstrapping");

    const expired = workflow({
      mode: "forced",
      exclusiveExecutionBlockUntil: "2026-08-14T09:00:00Z",
    });
    const cancelled = workflow({
      mode: "forced",
      exclusiveExecutionBlockUntil: "2026-08-14T09:00:00Z",
    });
    expect(expired.expire("2026-08-15T08:59:59Z")).toBeNull();
    expect(expired.expire("2026-08-15T09:00:00Z")?.status).toBe("failed");
    cancelled.cancel("2026-08-15T09:00:00Z");
    expect(expired.snapshot()).toMatchObject({
      status: "failed",
      pendingLeaseEpoch: null,
      pin: null,
      bootstrapExpiresAt: null,
      stateDeadline: null,
      terminalReason: "expired",
    });
    expect(cancelled.snapshot()).toMatchObject({
      status: "cancelled",
      pendingLeaseEpoch: null,
      pin: null,
      bootstrapExpiresAt: null,
      stateDeadline: null,
      terminalReason: "cancelled",
    });
    expect(() => expired.enterBootstrapping({
      pendingLeaseEpoch: 2,
      capabilityJti: "capability-2",
      now: "2026-08-15T09:00:00Z",
    })).toThrowError("WORKFLOW_FAILED");
    expect(() => cancelled.enterBootstrapping({
      pendingLeaseEpoch: 2,
      capabilityJti: "capability-2",
      now: "2026-08-15T09:00:00Z",
    })).toThrowError("WORKFLOW_CANCELLED");
  });

  it("P16-INV-6/7/18 enters bootstrapping atomically without granting execution scopes", () => {
    expect(BOOTSTRAP_CAPABILITY_TTL_SECONDS).toBeLessThanOrEqual(3_600);
    expect(PIN_TTL_SECONDS).toBeLessThanOrEqual(BOOTSTRAP_CAPABILITY_TTL_SECONDS);
    const aggregate = workflow();
    const leases = new ActiveDeviceLeaseLifecycle();
    const pendingLeaseEpoch = leases.beginBootstrap("account-1", "switch-1", null);
    aggregate.enterBootstrapping({
      pendingLeaseEpoch,
      capabilityJti: "capability-1",
      now: "2026-08-14T08:00:00Z",
      expectedWorkflowRevision: 0,
    });
    expect(aggregate.snapshot()).toMatchObject({
      status: "bootstrapping",
      workflowRevision: 1,
      pendingLeaseEpoch: 1,
      capability: { jti: "capability-1", consumedAt: null },
    });
    expect(aggregate.targetAuthority()).toEqual({
      schemaVersion: 1,
      role: "standby",
      scopes: ["account:manage", "workspace:read"],
    });
    expect(leases.getStatus("account-1", "2026-08-14T08:00:00Z")).toMatchObject({ held: false });
  });

  it("P16-INV-8/9 makes cancellation idempotent, absorbing, and cleanup-equivalent", () => {
    const aggregate = workflow();
    aggregate.enterBootstrapping({ pendingLeaseEpoch: 1, capabilityJti: "capability-1", now: "2026-08-14T08:00:00Z" });
    const first = aggregate.cancel("2026-08-14T08:01:00Z");
    const second = aggregate.cancel("2026-08-14T08:02:00Z");
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(aggregate.snapshot()).toMatchObject({
      status: "cancelled",
      pendingLeaseEpoch: null,
      pin: null,
      bootstrapExpiresAt: null,
      capability: { consumedAt: "2026-08-14T08:01:00Z", consumedReason: "cancelled" },
    });
  });
});

describe("DevicesFixtureService control-plane guards", () => {
  const request = { schemaVersion: 1 as const, mode: "normal" as const, toDeviceId: "device-b", idempotencyKey: "switch-key" };

  it("evaluates recovery, security epoch, entitlement, and binding guards in frozen order", () => {
    rejection(new DevicesFixtureService({ accountSecurityState: "recovery_pending" }).requestSwitch(request), "ACCOUNT_RECOVERY_PENDING");
    rejection(new DevicesFixtureService({ accountSecurityEpoch: 2, callerAccountSecurityEpoch: 1 }).requestSwitch(request), "ACCOUNT_SECURITY_EPOCH_STALE");
    rejection(new DevicesFixtureService({ entitlementActive: false }).requestSwitch(request), "ENTITLEMENT_INACTIVE");
    rejection(new DevicesFixtureService().requestSwitch(request), "DEVICE_NOT_BOUND");
    rejection(new DevicesFixtureService({
      seedBindings: [binding("device-b", "none", {
        status: "removed",
        removedAt: "2026-01-01T00:00:00Z",
        signingKeyStatus: "revoked",
      })],
    }).requestSwitch(request), "DEVICE_REMOVED");
    rejection(new DevicesFixtureService({
      seedBindings: [binding("device-b", "none", { signingKeyStatus: "revoked" })],
    }).requestSwitch(request), "DEVICE_NOT_BOUND");
  });

  it("preserves forced reauthentication order and blocks a normal request with no Active during isolation", () => {
    const forced = { schemaVersion: 1 as const, mode: "forced" as const, toDeviceId: "device-b", idempotencyKey: "forced-key", reauthProofId: "proof" };
    rejection(new DevicesFixtureService({ seedBindings: [binding("device-b", "standby")] }).requestSwitch(forced), "REAUTHENTICATION_REQUIRED");
    rejection(new DevicesFixtureService({
      seedBindings: [binding("device-b", "standby")],
      reauthCheck: () => accountRejectionSchema.parse({
        schemaVersion: 1,
        code: "REAUTH_PROOF_EXPIRED",
        retryable: false,
        retryAfterSeconds: null,
        correlationId: "expired-proof",
      }),
    }).requestSwitch(forced), "REAUTH_PROOF_EXPIRED");

    const isolated = new DevicesFixtureService({
      reauthCheck: () => null,
      seedBindings: [binding("device-a", "active"), binding("device-b", "standby")],
      activeLease: {
        deviceId: "device-a",
        leaseEpoch: 1,
        issuedAt: "2025-12-31T23:00:00Z",
        renewAfter: "2025-12-31T23:05:00Z",
        onlineExpiresAt: "2025-12-31T23:15:00Z",
        offlineExecuteUntil: "2026-01-01T01:00:00Z",
      },
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    isolated.removeDevice({
      schemaVersion: 1,
      deviceId: "device-a",
      expectedCredentialEpoch: 1,
      expectedListRevision: 1,
      reauthProofId: "proof",
    });
    rejection(isolated.requestSwitch(request), "EXCLUSIVE_EXECUTION_BLOCKED");
  });

  it("P16-E-7 accepts forced request in isolation and only claim_takeover rejects", () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const service = new DevicesFixtureService({
      now: () => now,
      reauthCheck: () => null,
      seedBindings: [binding("device-a", "active"), binding("device-b", "standby")],
      activeLease: {
        deviceId: "device-a",
        leaseEpoch: 7,
        issuedAt: "2025-12-31T23:00:00Z",
        renewAfter: "2025-12-31T23:05:00Z",
        onlineExpiresAt: "2025-12-31T23:15:00Z",
        offlineExecuteUntil: "2026-01-01T01:00:00Z",
      },
    });
    service.removeDevice({
      schemaVersion: 1,
      deviceId: "device-a",
      expectedCredentialEpoch: 1,
      expectedListRevision: 1,
      reauthProofId: "proof",
    });
    const waiting = deviceSwitchRequestViewSchema.parse(service.requestSwitch({
      schemaVersion: 1,
      mode: "forced",
      toDeviceId: "device-b",
      idempotencyKey: "forced-key",
      reauthProofId: "proof",
    }));
    expect(waiting.status).toBe("waiting_expiry");
    rejection(service.claimTakeover(waiting.requestId), "EXCLUSIVE_EXECUTION_BLOCKED");
    now = new Date("2026-01-01T01:00:00Z");
    expect(service.expireSwitch(waiting.requestId)).toBeNull();
    expect(deviceSwitchRequestViewSchema.parse(service.claimTakeover(waiting.requestId)).status).toBe("bootstrapping");
  });

  it("expires waiting_expiry at the exact claim deadline and releases the account mutex", () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const service = new DevicesFixtureService({
      now: () => now,
      reauthCheck: () => null,
      seedBindings: [binding("device-a", "active"), binding("device-b", "standby")],
      activeLease: {
        deviceId: "device-a",
        leaseEpoch: 7,
        issuedAt: "2025-12-31T23:00:00Z",
        renewAfter: "2025-12-31T23:05:00Z",
        onlineExpiresAt: "2025-12-31T23:15:00Z",
        offlineExecuteUntil: "2026-01-01T01:00:00Z",
      },
    });
    service.removeDevice({
      schemaVersion: 1,
      deviceId: "device-a",
      expectedCredentialEpoch: 1,
      expectedListRevision: 1,
      reauthProofId: "proof",
    });
    const waiting = deviceSwitchRequestViewSchema.parse(service.requestSwitch({
      schemaVersion: 1,
      mode: "forced",
      toDeviceId: "device-b",
      idempotencyKey: "forced-key",
      reauthProofId: "proof",
    }));
    now = new Date("2026-01-02T01:00:00Z");
    expect(service.expireSwitch(waiting.requestId)?.status).toBe("failed");
    expect(deviceSwitchRequestViewSchema.parse(service.requestSwitch({
      schemaVersion: 1,
      mode: "forced",
      toDeviceId: "device-b",
      idempotencyKey: "forced-after-expiry",
      reauthProofId: "proof",
    })).status).toBe("waiting_expiry");
  });

  it("expires requested and draining workflows, releases the account mutex, and preserves terminal rejection semantics", () => {
    let requestedNow = new Date("2026-08-14T08:00:00Z");
    const requestedService = new DevicesFixtureService({
      now: () => requestedNow,
      seedBindings: [binding("device-b", "standby")],
    });
    const requested = deviceSwitchRequestViewSchema.parse(requestedService.requestSwitch(request));
    expect(requested.status).toBe("requested");
    expect(requestedService.expireSwitch(requested.requestId)).toBeNull();
    requestedNow = new Date("2026-08-15T08:00:00Z");
    expect(requestedService.expireSwitch(requested.requestId)?.status).toBe("failed");
    rejection(requestedService.beginBootstrap(requested.requestId), "ACTIVE_DEVICE_CONFLICT");
    expect(deviceSwitchRequestViewSchema.parse(requestedService.requestSwitch({
      ...request,
      idempotencyKey: "requested-after-expiry",
    })).status).toBe("requested");

    let drainingNow = new Date("2026-08-14T08:00:00Z");
    const drainingService = new DevicesFixtureService({
      now: () => drainingNow,
      seedBindings: [binding("device-a", "active"), binding("device-b", "standby")],
    });
    const draining = deviceSwitchRequestViewSchema.parse(drainingService.requestSwitch(request));
    expect(draining.status).toBe("draining");
    drainingNow = new Date("2026-08-15T08:00:00Z");
    expect(drainingService.expireSwitch(draining.requestId)?.status).toBe("failed");
    rejection(drainingService.beginBootstrap(draining.requestId), "ACTIVE_DEVICE_CONFLICT");
    expect(deviceSwitchRequestViewSchema.parse(drainingService.requestSwitch({
      ...request,
      idempotencyKey: "draining-after-expiry",
    })).status).toBe("draining");

    const cancelledService = new DevicesFixtureService({ seedBindings: [binding("device-b", "standby")] });
    const cancelled = deviceSwitchRequestViewSchema.parse(cancelledService.requestSwitch(request));
    expect(deviceSwitchRequestViewSchema.parse(cancelledService.cancelSwitch(cancelled.requestId)).status).toBe("cancelled");
    rejection(cancelledService.beginBootstrap(cancelled.requestId), "ACTIVE_DEVICE_CONFLICT");
    expect(deviceSwitchRequestViewSchema.parse(cancelledService.requestSwitch({
      ...request,
      idempotencyKey: "requested-after-cancel",
    })).status).toBe("requested");
  });

  it("P16-INV-10 fails an in-flight workflow on credentialEpoch advance and refuses rotation during bootstrap", () => {
    const service = new DevicesFixtureService({ seedBindings: [binding("device-b", "standby")] });
    const requested = deviceSwitchRequestViewSchema.parse(service.requestSwitch(request));
    service.advanceCredentialEpoch("device-b");
    expect(service.getSwitchStatus(requested.requestId)?.status).toBe("failed");

    const second = new DevicesFixtureService({ seedBindings: [binding("device-b", "standby")] });
    const switchView = deviceSwitchRequestViewSchema.parse(second.requestSwitch(request));
    expect(deviceSwitchRequestViewSchema.parse(second.beginBootstrap(switchView.requestId)).status).toBe("bootstrapping");
    rejection(second.rotateSigningKey("device-b", "key-b-2", 2), "ACTIVE_DEVICE_CONFLICT");

    const securityCascade = new DevicesFixtureService({ seedBindings: [binding("device-b", "standby")] });
    const securityView = deviceSwitchRequestViewSchema.parse(securityCascade.requestSwitch(request));
    securityCascade.advanceAccountSecurityEpoch();
    expect(securityCascade.getSwitchStatus(securityView.requestId)?.status).toBe("failed");
  });

  it("keeps a normal switch draining when the P0-17 drain verifier refuses", async () => {
    const service = new DevicesFixtureService({
      seedBindings: [binding("device-a", "active"), binding("device-b", "standby")],
    });
    const view = deviceSwitchRequestViewSchema.parse(service.requestSwitch(request));
    expect(view.status).toBe("draining");
    expect(await service.acceptDrain(view.requestId, {})).toEqual({ code: "DRAIN_PROOF_UNVERIFIED" });
    expect(service.getSwitchStatus(view.requestId)?.status).toBe("draining");
  });

  it("P16-INV-28 projects no capability, nonce, pin, or pending epoch", () => {
    const service = new DevicesFixtureService({ seedBindings: [binding("device-b", "standby")] });
    const view = deviceSwitchRequestViewSchema.parse(service.requestSwitch(request));
    const bootstrap = deviceSwitchRequestViewSchema.parse(service.beginBootstrap(view.requestId));
    const wire = JSON.stringify(bootstrap);
    expect(wire).not.toMatch(/capability|jti|nonce|pendingLeaseEpoch|checkpointDigest|workflowRevision/);
  });
});
