import { describe, expect, it } from "vitest";

import {
  parseAutomationGrantReceipt,
  parseBrowserExecutionTask,
  parseBrowserHandoffViewModel,
  parseNativeSecretCaptureReceipt,
  parseSessionConsentReceipt,
  ValidatingBrowserAutomationGrantPort,
  ValidatingBrowserExecutionControlPort,
  ValidatingBrowserSessionConsentPort,
  ValidatingNativeSecretCapturePort,
  type BrowserAutomationGrantBoundary,
  type BrowserExecutionControlBoundary,
  type BrowserSessionConsentBoundary,
  type NativeSecretCaptureBoundary,
  type OpenNativeSecretCaptureCommand,
} from "./index";

const consent = {
  schemaVersion: 1,
  consentRequestId: "consent_01",
  providerConnectionId: "pc_atom_main",
  browserSessionId: "session_01",
  provider: "Atom",
  accountAlias: "主账户",
  purpose: "acquire_api_key",
  allowedAuthHosts: ["*.atom.com"],
  sessionMode: "persistent",
  issuedAt: "2026-08-17T06:00:00Z",
  expiresAt: "2026-08-17T06:30:00Z",
} as const;

const grant = {
  schemaVersion: 1,
  grantRequestId: "grant_01",
  providerConnectionId: "pc_afternic_main",
  browserSessionId: "session_02",
  operationPlanId: "plan_01",
  approvedPlanHash: "a".repeat(64),
  provider: "Afternic",
  accountAlias: "主账户",
  planItemCount: 823,
  planActionLabel: "上传价格 CSV",
  allowedActions: ["click", "fill", "upload_csv", "read_result"],
  targetDomains: ["example.com"],
  allowedHosts: ["*.afternic.com"],
  issuedAt: "2026-08-17T06:00:00Z",
  expiresAt: "2026-08-17T06:10:00Z",
  requiresFinalConfirmation: true,
} as const;

describe("browser handoff boundary", () => {
  it("parses consent review and user-operation phases without plan authority", () => {
    const review = parseBrowserHandoffViewModel({
      schemaVersion: 1,
      mode: "session_consent",
      phase: "review",
      consent,
      admission: { status: "proven", action: "record_consent_and_open" },
    });
    const userOperation = parseBrowserHandoffViewModel({
      schemaVersion: 1,
      mode: "session_consent",
      phase: "user_operation",
      consent,
      loginState: "login_observed",
      admission: { status: "proven", action: "continue_to_native_capture" },
    });

    expect(review.mode).toBe("session_consent");
    expect(userOperation.phase).toBe("user_operation");
    expect(review).not.toHaveProperty("grant");
  });

  it("models native capture without a TypeScript-visible input value", () => {
    const view = parseBrowserHandoffViewModel({
      schemaVersion: 1,
      mode: "native_secret_capture",
      phase: "ready",
      nativeCaptureRequestId: "native_capture_01",
      providerConnectionId: "pc_atom_main",
      provider: "Atom",
      accountAlias: "主账户",
      credentialLabel: "API Key",
      admission: { status: "proven", action: "open_native_capture" },
    });
    const command: OpenNativeSecretCaptureCommand = {
      kind: "open_native_secret_capture",
      nativeCaptureRequestId: "native_capture_01",
    };

    expect(Object.keys(view).sort()).toEqual([
      "accountAlias",
      "admission",
      "credentialLabel",
      "mode",
      "nativeCaptureRequestId",
      "phase",
      "provider",
      "providerConnectionId",
      "schemaVersion",
    ]);
    expect(Object.keys(command).sort()).toEqual(["kind", "nativeCaptureRequestId"]);
  });

  it("keeps consent and execution Grant as strict, non-interchangeable contracts", () => {
    expect(() =>
      parseBrowserHandoffViewModel({
        schemaVersion: 1,
        mode: "session_consent",
        phase: "review",
        consent: { ...consent, operationPlanId: "plan_01" },
        admission: { status: "proven", action: "record_consent_and_open" },
      }),
    ).toThrow("invalid browser handoff projection");

    expect(() =>
      parseBrowserHandoffViewModel({
        schemaVersion: 1,
        mode: "execution_grant",
        phase: "review",
        grant: { ...grant, purpose: "login" },
        admission: { status: "proven", action: "record_grant" },
      }),
    ).toThrow("invalid browser handoff projection");

    expect(() => parseAutomationGrantReceipt({ outcome: "recorded", receiptId: "consent_01", consentRequestId: "consent_01" })).toThrow(
      "invalid automation grant receipt",
    );
  });

  it("omits actions whenever admission is not proven", () => {
    const consentUnavailable = parseBrowserHandoffViewModel({
      schemaVersion: 1,
      mode: "session_consent",
      phase: "review",
      consent,
      admission: { status: "unavailable", reason: "gate_unproven" },
    });
    const captureUnavailable = parseBrowserHandoffViewModel({
      schemaVersion: 1,
      mode: "native_secret_capture",
      phase: "unavailable",
      nativeCaptureRequestId: "native_capture_01",
      providerConnectionId: "pc_atom_main",
      provider: "Atom",
      accountAlias: "主账户",
      credentialLabel: "API Key",
      admission: { status: "unavailable", reason: "host_unavailable" },
    });
    const grantUnavailable = parseBrowserHandoffViewModel({
      schemaVersion: 1,
      mode: "execution_grant",
      phase: "review",
      grant,
      admission: { status: "unavailable", reason: "gate_unproven" },
    });

    expect("admission" in consentUnavailable ? consentUnavailable.admission : null).not.toHaveProperty("action");
    expect("admission" in captureUnavailable ? captureUnavailable.admission : null).not.toHaveProperty("action");
    expect("admission" in grantUnavailable ? grantUnavailable.admission : null).not.toHaveProperty("action");
  });

  it("fails closed for unknown or internally inconsistent task, session, and Grant shapes", () => {
    const cases: unknown[] = [
      {
        schemaVersion: 1,
        mode: "session_consent",
        phase: "user_operation",
        consent,
        loginState: "awaiting_user",
        admission: { status: "proven", action: "continue_to_native_capture" },
      },
      {
        schemaVersion: 1,
        mode: "execution_grant",
        phase: "review",
        grant: { ...grant, allowedHosts: ["https://afternic.com/path"] },
        admission: { status: "proven", action: "record_grant" },
      },
      {
        schemaVersion: 1,
        mode: "session_consent",
        phase: "review",
        consent: { ...consent, expiresAt: consent.issuedAt },
        admission: { status: "proven", action: "record_consent_and_open" },
      },
      {
        schemaVersion: 1,
        taskId: "task_01",
        providerConnectionId: "pc_afternic_main",
        browserSessionId: "session_02",
        provider: "Afternic",
        accountAlias: "主账户",
        allowedHosts: ["*.afternic.com"],
        operator: "software",
        state: "paused",
        nextStepLabel: "等待继续",
        remainingItems: 5,
        controlAdmission: { status: "proven", controls: ["pause_and_take_over"] },
      },
    ];

    expect(() => parseBrowserHandoffViewModel(cases[0])).toThrow("invalid browser handoff projection");
    expect(() => parseBrowserHandoffViewModel(cases[1])).toThrow("invalid browser handoff projection");
    expect(() => parseBrowserHandoffViewModel(cases[2])).toThrow(
      "invalid browser handoff projection",
    );
    expect(() => parseBrowserExecutionTask(cases[3])).toThrow(
      "invalid browser execution task projection",
    );
  });

  it("does not echo secret-like boundary values into ordinary errors", () => {
    const canary = "GD_PRIVATE_VALUE_CANARY_9D81";
    let error: unknown;
    try {
      parseBrowserHandoffViewModel({
        schemaVersion: 1,
        mode: "native_secret_capture",
        phase: "ready",
        nativeCaptureRequestId: "native_capture_01",
        providerConnectionId: "pc_atom_main",
        provider: "Atom",
        accountAlias: "主账户",
        credentialLabel: "API Key",
        admission: { status: "proven", action: "open_native_capture" },
        value: canary,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).not.toContain(canary);
  });

  it("treats consent, capture, and Grant responses as receipts, never execution success", () => {
    expect(parseSessionConsentReceipt({ outcome: "cancelled" })).toEqual({ outcome: "cancelled" });
    expect(parseNativeSecretCaptureReceipt({ outcome: "unavailable" })).toEqual({
      outcome: "unavailable",
    });
    expect(parseAutomationGrantReceipt({ outcome: "recorded", receiptId: "grant_receipt_01" })).toEqual({
      outcome: "recorded",
      receiptId: "grant_receipt_01",
    });
  });

  it("validates every opaque boundary response without implementing a Host", async () => {
    const consentBoundary: BrowserSessionConsentBoundary = {
      recordConsent: async () => ({ outcome: "recorded", receiptId: "consent_receipt_01" }),
    };
    const captureBoundary: NativeSecretCaptureBoundary = {
      openNativeCapture: async () => ({
        outcome: "recorded",
        receiptId: "capture_receipt_01",
        redactedFingerprint: "…C93F",
      }),
    };
    const grantBoundary: BrowserAutomationGrantBoundary = {
      recordGrant: async () => ({ outcome: "cancelled" }),
    };
    const controlBoundary: BrowserExecutionControlBoundary = {
      requestControl: async () => ({ outcome: "recorded", controlRequestId: "control_01" }),
    };

    await expect(
      new ValidatingBrowserSessionConsentPort(consentBoundary).recordConsent({
        kind: "record_browser_session_consent",
        consentRequestId: "consent_01",
      }),
    ).resolves.toEqual({ outcome: "recorded", receiptId: "consent_receipt_01" });
    await expect(
      new ValidatingNativeSecretCapturePort(captureBoundary).openNativeCapture({
        kind: "open_native_secret_capture",
        nativeCaptureRequestId: "native_capture_01",
      }),
    ).resolves.toEqual({
      outcome: "recorded",
      receiptId: "capture_receipt_01",
      redactedFingerprint: "…C93F",
    });
    await expect(
      new ValidatingBrowserAutomationGrantPort(grantBoundary).recordGrant({
        kind: "record_browser_automation_grant",
        grantRequestId: "grant_01",
      }),
    ).resolves.toEqual({ outcome: "cancelled" });
    await expect(
      new ValidatingBrowserExecutionControlPort(controlBoundary).requestControl(
        "task_01",
        "pause_and_take_over",
      ),
    ).resolves.toEqual({ outcome: "recorded", controlRequestId: "control_01" });
  });
});
