import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  projectActivationWizardViewModel,
  projectAuthGateViewModel,
  projectDrainingViewModel,
  projectForcedSwitchViewModel,
  projectLocalContinuationViewModel,
  projectLockedAccountViewModel,
  projectNetworkCapabilityViewModel,
} from "./presentation-models";

const timestamp = "2026-08-17T05:00:00Z";

function expectInvalid(project: (input: unknown) => { readonly ok: boolean }, valid: Record<string, unknown>) {
  expect(project(null)).toEqual({ ok: false, issue: "invalid_state" });
  expect(project({})).toEqual({ ok: false, issue: "invalid_state" });
  expect(project({ ...valid, unexpected: true })).toEqual({ ok: false, issue: "invalid_state" });
}

describe("runtime presentation boundary corpus", () => {
  it("keeps account secrets out of every auth view-model state", () => {
    const states = [
      {
        kind: "sign_in",
        busy: false,
        errorKey: null,
        rememberDevice: true,
        entryRevealed: false,
        availableActions: ["submit"],
      },
      {
        kind: "register",
        busy: false,
        errorKey: null,
        termsAccepted: false,
        entryRevealed: false,
        availableActions: ["submit"],
      },
      {
        kind: "verify_email",
        busy: false,
        errorKey: null,
        emailDisplay: "masked@example.com",
        oneTimeCodeLength: 6,
        resend: { kind: "available" },
        availableActions: ["submit", "resend_code"],
      },
      {
        kind: "account_recovery",
        busy: false,
        errorKey: null,
        resetLinkSent: true,
        availableActions: ["back"],
      },
    ];

    for (const state of states) {
      const result = projectAuthGateViewModel(state);
      expect(result.ok).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/password|verificationCode|secret|credential/i);
    }
    expectInvalid(projectAuthGateViewModel, states[0]!);
    expect(projectAuthGateViewModel({ ...states[0], availableActions: ["resend_code"] })).toEqual({
      ok: false,
      issue: "invalid_state",
    });
  });

  it("models every lock reason and rejects wrong-reason actions", () => {
    const fixtures = [
      {
        reason: "entitlement_expired",
        accountDisplay: "masked@example.com",
        plan: { kind: "annual_subscription", planId: "pro-annual" },
        commercialExpiresAt: timestamp,
        offlineGraceEndedAt: timestamp,
        availableActions: ["renew", "switch_account", "quit", "open_account_web"],
      },
      {
        reason: "device_removed",
        accountDisplay: "masked@example.com",
        plan: { kind: "lifetime", planId: "lifetime" },
        deviceDisplay: "Main Mac",
        removedAt: timestamp,
        availableActions: ["switch_account", "quit"],
      },
      {
        reason: "offline_lease_expired",
        accountDisplay: "masked@example.com",
        plan: { kind: "monthly_subscription", planId: "pro-monthly" },
        offlineLeaseExpiredAt: timestamp,
        availableActions: ["switch_account", "quit"],
      },
      {
        reason: "local_integrity_failure",
        accountDisplay: "masked@example.com",
        plan: { kind: "annual_subscription", planId: "pro-annual" },
        diagnosticReference: "diagnostic-1",
        availableActions: ["start_local_recovery", "quit"],
      },
    ];

    for (const fixture of fixtures) {
      const result = projectLockedAccountViewModel(fixture);
      expect(result).toMatchObject({ ok: true, value: { reason: fixture.reason } });
    }
    expectInvalid(projectLockedAccountViewModel, fixtures[0]!);
    expect(projectLockedAccountViewModel({ ...fixtures[1], availableActions: ["renew"] })).toEqual({
      ok: false,
      issue: "invalid_state",
    });
    expect(projectLockedAccountViewModel({
      ...fixtures[0],
      plan: { kind: "lifetime", planId: "lifetime" },
    })).toEqual({ ok: false, issue: "invalid_state" });
  });

  it("covers all five activation steps with Host identity and Cloud lease authority", () => {
    const steps = [
      { step: "welcome", availableActions: ["continue", "skip"] },
      {
        step: "device",
        deviceName: "Main Mac",
        activationState: "ready",
        deviceIdentity: { status: "not_started" },
        activeLease: { status: "not_requested" },
        availableActions: ["submit_device"],
      },
      {
        step: "connections",
        providers: [{
          providerId: "provider-a",
          displayName: "Provider A",
          metadata: "OAuth",
          category: "registrar",
          connectionState: "connected",
        }],
        connectedCount: 1,
        availableActions: ["connect_provider", "continue"],
      },
      {
        step: "initial_import",
        connectedCount: 1,
        importState: "completed",
        progress: 100,
        importedDomains: 823,
        importedListings: 692,
        conflicts: 6,
        baselineServerRevision: 1,
        availableActions: ["continue"],
      },
      {
        step: "complete",
        deviceName: "Main Mac",
        importedDomains: 823,
        baselineServerRevision: 1,
        syncReady: true,
        availableActions: ["enter_workspace"],
      },
    ];

    for (const step of steps) expect(projectActivationWizardViewModel(step).ok).toBe(true);
    expectInvalid(projectActivationWizardViewModel, steps[0]!);
    expect(projectActivationWizardViewModel({ ...steps[2], connectedCount: 0 })).toEqual({
      ok: false,
      issue: "invalid_state",
    });
    expect(projectActivationWizardViewModel({ ...steps[3], baselineServerRevision: null })).toEqual({
      ok: false,
      issue: "invalid_state",
    });
    expect(projectActivationWizardViewModel({ ...steps[0], availableActions: ["enter_workspace"] })).toEqual({
      ok: false,
      issue: "invalid_state",
    });
  });

  it("keeps activation in activating and awaiting-Cloud until Cloud issues the bound-device lease", () => {
    const activating = {
      step: "device",
      deviceName: "Main Mac",
      activationState: "activating",
      deviceIdentity: { status: "creating" },
      activeLease: { status: "not_requested" },
      availableActions: [],
    };
    const awaitingCloud = {
      ...activating,
      activationState: "awaiting_cloud",
      deviceIdentity: { status: "bound", deviceId: "device-main" },
      activeLease: { status: "awaiting_cloud" },
    };
    const active = {
      ...awaitingCloud,
      activationState: "active",
      activeLease: {
        status: "issued",
        issuer: "gooddealer_cloud",
        deviceId: "device-main",
        leaseEpoch: 1,
      },
      availableActions: ["continue"],
    };

    expect(projectActivationWizardViewModel(activating).ok).toBe(true);
    expect(projectActivationWizardViewModel(awaitingCloud).ok).toBe(true);
    expect(projectActivationWizardViewModel(active).ok).toBe(true);
    expect(projectActivationWizardViewModel({
      ...awaitingCloud,
      activeLease: active.activeLease,
    })).toEqual({ ok: false, issue: "invalid_state" });
    expect(projectActivationWizardViewModel({
      ...active,
      activeLease: { ...active.activeLease, issuer: "local_host" },
    })).toEqual({ ok: false, issue: "invalid_state" });
    expect(projectActivationWizardViewModel({
      ...active,
      activeLease: { ...active.activeLease, deviceId: "another-device" },
    })).toEqual({ ok: false, issue: "invalid_state" });
  });

  it("requires acknowledgement before a forced switch action becomes available", () => {
    const confirmation = {
      stage: "request_confirmation",
      oldDeviceDisplay: "Main Mac",
      lastOnlineDisplay: "06-12 05:44",
      acknowledged: false,
      availableActions: ["acknowledge_risk"],
    };
    expect(projectForcedSwitchViewModel(confirmation).ok).toBe(true);
    expect(projectForcedSwitchViewModel({
      ...confirmation,
      availableActions: ["request_switch"],
    })).toEqual({ ok: false, issue: "invalid_state" });
    expect(projectForcedSwitchViewModel({
      ...confirmation,
      availableActions: ["open_manual_platform"],
    })).toEqual({ ok: false, issue: "invalid_state" });
    expectInvalid(projectForcedSwitchViewModel, confirmation);
  });

  it("renders adjudicated forced-switch time without consulting a local clock", () => {
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("projection must not consult a local clock");
    });
    const result = projectForcedSwitchViewModel({
      stage: "isolation_wait",
      oldDeviceDisplay: "Main Mac",
      lastOnlineDisplay: "06-12 05:44",
      earliestTakeoverAt: timestamp,
      earliestTakeoverDisplay: "Tomorrow 05:44",
      remainingDisplay: "23:41:08",
      estimatedRecoveryItems: 14,
      emergencyAffectedDisplay: "vault.example · SellerHub",
      availableActions: ["cancel_switch", "open_manual_platform", "copy_affected_domains"],
    });
    expect(result).toMatchObject({ ok: true, value: { remainingDisplay: "23:41:08" } });
    expect(clock).not.toHaveBeenCalled();
  });

  it("reduces three-axis network capabilities with the strictest intersection", () => {
    const base = {
      deviceStatus: "reachable",
      cloudStatus: "unreachable",
      cloudCanSync: true,
      cloudCanSwitchDevice: true,
      localCanViewAssets: true,
      localCanEditDesiredState: true,
      localCanPreparePlans: true,
      providers: [
        {
          providerId: "reachable-provider",
          displayName: "Reachable",
          status: "reachable",
          canRead: true,
          canSubmit: true,
          canConfirm: true,
        },
        {
          providerId: "down-provider",
          displayName: "Down",
          status: "unreachable",
          canRead: true,
          canSubmit: true,
          canConfirm: true,
        },
      ],
      offlineExecutionWindow: { kind: "adjudicated", remainingDisplay: "21:08" },
    };
    const result = projectNetworkCapabilityViewModel(base);
    expect(result).toMatchObject({
      ok: true,
      value: {
        degradation: "warning",
        cloudCanSync: false,
        cloudCanSwitchDevice: false,
        reasons: ["cloud_unreachable", "provider_unreachable"],
        providers: [
          { canRead: true, canSubmit: true, canConfirm: true },
          { canRead: false, canSubmit: false, canConfirm: false },
        ],
      },
    });

    const deviceOffline = projectNetworkCapabilityViewModel({
      ...base,
      deviceStatus: "unreachable",
      offlineExecutionWindow: { kind: "unavailable" },
    });
    expect(deviceOffline).toMatchObject({
      ok: true,
      value: {
        degradation: "danger",
        reasons: ["device_unreachable", "cloud_unreachable", "provider_unreachable"],
        providers: [
          { status: "reachable", canRead: false, canSubmit: false, canConfirm: false },
          { status: "unreachable", canRead: false, canSubmit: false, canConfirm: false },
        ],
      },
    });
    expect(deviceOffline).toMatchObject({
      ok: true,
      value: {
        deviceStatus: "unreachable",
        cloudStatus: "unreachable",
        reasons: ["device_unreachable", "cloud_unreachable", "provider_unreachable"],
      },
    });

    const independentCloudAxis = projectNetworkCapabilityViewModel({
      ...base,
      deviceStatus: "unreachable",
      cloudStatus: "reachable",
      offlineExecutionWindow: { kind: "unavailable" },
    });
    expect(independentCloudAxis).toMatchObject({
      ok: true,
      value: {
        deviceStatus: "unreachable",
        cloudStatus: "reachable",
        reasons: ["device_unreachable", "provider_unreachable"],
        providers: [
          { status: "reachable", canRead: false, canSubmit: false, canConfirm: false },
          { status: "unreachable", canRead: false, canSubmit: false, canConfirm: false },
        ],
      },
    });
    const noOfflineAuthority = projectNetworkCapabilityViewModel({
      ...base,
      offlineExecutionWindow: { kind: "unavailable" },
    });
    expect(noOfflineAuthority).toMatchObject({
      ok: true,
      value: {
        providers: [
          { canRead: false, canSubmit: false, canConfirm: false },
          { canRead: false, canSubmit: false, canConfirm: false },
        ],
      },
    });
    expectInvalid(projectNetworkCapabilityViewModel, base);
  });

  it("never exposes business actions while draining", () => {
    const value = {
      reason: "handoff",
      phase: "uploading_envelopes",
      streams: [
        { stream: "mutations", acknowledgedSequence: 8, pendingCount: 1, gapCount: 0 },
        { stream: "execution_facts", acknowledgedSequence: 5, pendingCount: 0, gapCount: 0 },
        { stream: "workspace_device_audit", acknowledgedSequence: 6, pendingCount: 0, gapCount: 0 },
      ],
      canCancel: false,
      failureReference: null,
    };
    expect(projectDrainingViewModel(value)).toMatchObject({
      ok: true,
      value: { businessActionsAvailable: false },
    });
    expectInvalid(projectDrainingViewModel, value);
    expect(projectDrainingViewModel({ ...value, streams: [value.streams[0], value.streams[0], value.streams[2]] }))
      .toEqual({ ok: false, issue: "invalid_state" });
  });

  it("keeps current LocalContinuation fail-closed and rejects invented capability fields", () => {
    const value = {
      artifactDisplay: "GoodDealer Sunset",
      authorizationState: "unavailable",
      workspaceState: "read_only",
    };
    expect(projectLocalContinuationViewModel(value)).toEqual({
      ok: true,
      value: {
        ...value,
        cloudAvailable: false,
        accountRequired: false,
        businessActions: [],
      },
    });
    expectInvalid(projectLocalContinuationViewModel, value);
    expect(projectLocalContinuationViewModel({ ...value, authorizationState: "authorized" })).toEqual({
      ok: false,
      issue: "invalid_state",
    });
  });

  it("contains no timers, network, Tauri, or fixture authority", () => {
    const source = readFileSync(new URL("./presentation-models.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/setTimeout|setInterval|fetch\s*\(|@tauri-apps|GD_DATA|fixture/i);
    expect(source).not.toMatch(/Date\.now|Date\.parse|getTime|performance\.now/);
    expect(source).not.toMatch(/signActiveDeviceLease|issueActiveDeviceLease|createActiveDeviceLease/);
  });
});
