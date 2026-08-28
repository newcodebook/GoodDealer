import { z } from "zod";

const identifier = z.string().trim().min(1).max(128);
const displayText = z.string().trim().min(1).max(512);
const optionalDisplayText = displayText.nullable();
const safeCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const progressPercent = z.number().int().min(0).max(100);
const canonicalUtcTimestamp = z.string().datetime({ offset: false, precision: 0 });

export type ProjectionResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly issue: "invalid_state" };

function projectStrict<Input, Output>(
  schema: z.ZodType<Input>,
  input: unknown,
  projector: (value: Input) => Output,
): ProjectionResult<Output> {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { ok: true, value: projector(parsed.data) }
    : { ok: false, issue: "invalid_state" };
}

const authActionSchema = z.enum([
  "submit",
  "toggle_entry_visibility",
  "start_account_recovery",
  "create_account",
  "sign_in",
  "oauth_google",
  "oauth_github",
  "passkey",
  "toggle_remember_device",
  "accept_terms",
  "open_terms",
  "open_privacy",
  "back",
  "resend_code",
]);

const authCommonSchema = z.object({
  busy: z.boolean(),
  errorKey: z.enum(["password_mismatch", "must_agree", "invalid_code"]).nullable(),
  availableActions: z.array(authActionSchema).max(14),
}).strict();

export const authGateSnapshotSchema = z.discriminatedUnion("kind", [
  authCommonSchema.extend({
    kind: z.literal("sign_in"),
    rememberDevice: z.boolean(),
    entryRevealed: z.boolean(),
  }).strict(),
  authCommonSchema.extend({
    kind: z.literal("register"),
    termsAccepted: z.boolean(),
    entryRevealed: z.boolean(),
  }).strict(),
  authCommonSchema.extend({
    kind: z.literal("verify_email"),
    emailDisplay: displayText,
    oneTimeCodeLength: z.literal(6),
    resend: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("available") }).strict(),
      z.object({ kind: z.literal("unavailable"), remainingLabel: displayText }).strict(),
    ]),
  }).strict(),
  authCommonSchema.extend({
    kind: z.literal("account_recovery"),
    resetLinkSent: z.boolean(),
  }).strict(),
]).superRefine((value, context) => {
  const allowedByState: Record<typeof value.kind, readonly z.infer<typeof authActionSchema>[]> = {
    sign_in: ["submit", "toggle_entry_visibility", "start_account_recovery", "create_account", "oauth_google", "oauth_github", "passkey", "toggle_remember_device"],
    register: ["submit", "toggle_entry_visibility", "accept_terms", "open_terms", "open_privacy", "sign_in"],
    verify_email: ["submit", "back", "resend_code"],
    account_recovery: ["submit", "back"],
  };
  if (value.availableActions.some((action) => !allowedByState[value.kind].includes(action))) {
    context.addIssue({ code: "custom", path: ["availableActions"], message: "action is unavailable for the auth state" });
  }
  if (value.kind === "verify_email" && value.resend.kind === "unavailable" && value.availableActions.includes("resend_code")) {
    context.addIssue({ code: "custom", path: ["availableActions"], message: "resend is not yet available" });
  }
});

export type AuthGateSnapshot = z.infer<typeof authGateSnapshotSchema>;

export type AuthGateViewModel = AuthGateSnapshot & {
  readonly availableActions: readonly z.infer<typeof authActionSchema>[];
};

/**
 * Passwords and verification codes never enter this view model. The Local App
 * form hands them directly to its injected write-only action boundary.
 */
export function projectAuthGateViewModel(input: unknown): ProjectionResult<AuthGateViewModel> {
  return projectStrict(authGateSnapshotSchema, input, (value) => ({
    ...value,
    availableActions: [...value.availableActions],
  }));
}

const lockedActionSchema = z.enum([
  "renew",
  "switch_account",
  "quit",
  "open_account_web",
  "start_local_recovery",
]);

const planViewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("monthly_subscription"), planId: identifier }).strict(),
  z.object({ kind: z.literal("annual_subscription"), planId: identifier }).strict(),
  z.object({ kind: z.literal("lifetime"), planId: identifier }).strict(),
]);

const lockedBase = {
  accountDisplay: displayText,
  plan: planViewSchema,
  availableActions: z.array(lockedActionSchema).max(5),
} as const;

export const lockedAccountSnapshotSchema = z.discriminatedUnion("reason", [
  z.object({
    ...lockedBase,
    reason: z.literal("entitlement_expired"),
    commercialExpiresAt: canonicalUtcTimestamp.nullable(),
    offlineGraceEndedAt: canonicalUtcTimestamp,
  }).strict(),
  z.object({
    ...lockedBase,
    reason: z.literal("device_removed"),
    deviceDisplay: displayText,
    removedAt: canonicalUtcTimestamp,
  }).strict(),
  z.object({
    ...lockedBase,
    reason: z.literal("offline_lease_expired"),
    offlineLeaseExpiredAt: canonicalUtcTimestamp,
  }).strict(),
  z.object({
    ...lockedBase,
    reason: z.literal("local_integrity_failure"),
    diagnosticReference: identifier,
  }).strict(),
]).superRefine((value, context) => {
  const allowedByReason: Record<typeof value.reason, readonly z.infer<typeof lockedActionSchema>[]> = {
    entitlement_expired: ["renew", "switch_account", "quit", "open_account_web"],
    device_removed: ["switch_account", "quit", "open_account_web"],
    offline_lease_expired: ["switch_account", "quit", "open_account_web"],
    local_integrity_failure: ["switch_account", "quit", "open_account_web", "start_local_recovery"],
  };
  if (value.availableActions.some((action) => !allowedByReason[value.reason].includes(action))) {
    context.addIssue({
      code: "custom",
      path: ["availableActions"],
      message: "action is unavailable for the authoritative lock reason",
    });
  }
  if (!value.availableActions.includes("quit")) {
    context.addIssue({ code: "custom", path: ["availableActions"], message: "a locked account must remain quit-able" });
  }
  if (value.reason === "entitlement_expired" && value.plan.kind === "lifetime") {
    context.addIssue({
      code: "custom",
      path: ["plan"],
      message: "a lifetime entitlement is not subscription-expired",
    });
  }
});

export type LockedAccountSnapshot = z.infer<typeof lockedAccountSnapshotSchema>;
export type LockedAccountViewModel = LockedAccountSnapshot;
export type LockedAccountAction = z.infer<typeof lockedActionSchema>;

export function projectLockedAccountViewModel(input: unknown): ProjectionResult<LockedAccountViewModel> {
  return projectStrict(lockedAccountSnapshotSchema, input, (value) => ({
    ...value,
    availableActions: [...value.availableActions],
  }));
}

const activationActionSchema = z.enum([
  "skip",
  "back",
  "continue",
  "submit_device",
  "connect_provider",
  "disconnect_provider",
  "start_import",
  "enter_workspace",
]);

const activationBase = {
  availableActions: z.array(activationActionSchema).max(9),
} as const;

const providerSchema = z.object({
  providerId: identifier,
  displayName: displayText,
  metadata: displayText,
  category: z.enum(["registrar", "dns", "marketplace"]),
  connectionState: z.enum(["disconnected", "connecting", "connected", "failed"]),
}).strict();

/** Redacted Host-owned identity lifecycle; no private key material crosses this boundary. */
export const hostDeviceIdentityProjectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_started") }).strict(),
  z.object({ status: z.literal("creating") }).strict(),
  z.object({ status: z.literal("bound"), deviceId: identifier }).strict(),
  z.object({ status: z.literal("failed"), diagnosticReference: identifier }).strict(),
]);

/** Redacted Cloud adjudication only. The signed lease envelope remains in the Secure Host. */
export const activeDeviceLeaseProjectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested") }).strict(),
  z.object({ status: z.literal("awaiting_cloud") }).strict(),
  z.object({
    status: z.literal("issued"),
    issuer: z.literal("gooddealer_cloud"),
    deviceId: identifier,
    leaseEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }).strict(),
  z.object({ status: z.literal("failed"), diagnosticReference: identifier }).strict(),
]);

export const activationWizardSnapshotSchema = z.discriminatedUnion("step", [
  z.object({ ...activationBase, step: z.literal("welcome") }).strict(),
  z.object({
    ...activationBase,
    step: z.literal("device"),
    deviceName: displayText,
    activationState: z.enum(["ready", "activating", "awaiting_cloud", "active", "failed"]),
    deviceIdentity: hostDeviceIdentityProjectionSchema,
    activeLease: activeDeviceLeaseProjectionSchema,
  }).strict(),
  z.object({
    ...activationBase,
    step: z.literal("connections"),
    providers: z.array(providerSchema).max(64),
    connectedCount: safeCount,
  }).strict(),
  z.object({
    ...activationBase,
    step: z.literal("initial_import"),
    connectedCount: safeCount,
    importState: z.enum(["ready", "in_progress", "completed", "failed"]),
    progress: progressPercent,
    importedDomains: safeCount.nullable(),
    importedListings: safeCount.nullable(),
    conflicts: safeCount.nullable(),
    baselineServerRevision: safeCount.nullable(),
  }).strict(),
  z.object({
    ...activationBase,
    step: z.literal("complete"),
    deviceName: displayText,
    importedDomains: safeCount,
    baselineServerRevision: safeCount,
    syncReady: z.boolean(),
  }).strict(),
]).superRefine((value, context) => {
  const allowedByStep: Record<typeof value.step, readonly z.infer<typeof activationActionSchema>[]> = {
    welcome: ["skip", "continue"],
    device: ["back", "submit_device", "continue"],
    connections: ["back", "connect_provider", "disconnect_provider", "continue"],
    initial_import: ["back", "start_import", "continue"],
    complete: ["enter_workspace"],
  };
  if (value.availableActions.some((action) => !allowedByStep[value.step].includes(action))) {
    context.addIssue({ code: "custom", path: ["availableActions"], message: "action is unavailable for the activation step" });
  }
  if (value.step === "connections") {
    const connected = value.providers.filter(({ connectionState }) => connectionState === "connected").length;
    if (connected !== value.connectedCount) {
      context.addIssue({ code: "custom", path: ["connectedCount"], message: "connected count disagrees" });
    }
    const ids = value.providers.map(({ providerId }) => providerId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: ["providers"], message: "provider ids must be unique" });
    }
  }
  if (value.step === "device") {
    const lifecycleMatches =
      (value.activationState === "ready" &&
        value.deviceIdentity.status === "not_started" &&
        value.activeLease.status === "not_requested") ||
      (value.activationState === "activating" &&
        value.deviceIdentity.status === "creating" &&
        value.activeLease.status === "not_requested") ||
      (value.activationState === "awaiting_cloud" &&
        value.deviceIdentity.status === "bound" &&
        value.activeLease.status === "awaiting_cloud") ||
      (value.activationState === "active" &&
        value.deviceIdentity.status === "bound" &&
        value.activeLease.status === "issued" &&
        value.deviceIdentity.deviceId === value.activeLease.deviceId) ||
      (value.activationState === "failed" &&
        ((value.deviceIdentity.status === "failed" && value.activeLease.status === "not_requested") ||
          (value.deviceIdentity.status === "bound" && value.activeLease.status === "failed")));
    if (!lifecycleMatches) {
      context.addIssue({
        code: "custom",
        path: ["activationState"],
        message: "activation state must preserve the Host identity and Cloud lease lifecycle",
      });
    }
    if (value.availableActions.includes("continue") && value.activationState !== "active") {
      context.addIssue({
        code: "custom",
        path: ["availableActions"],
        message: "activation cannot continue before Cloud issues the active lease",
      });
    }
    if (value.availableActions.includes("submit_device") &&
      value.activationState !== "ready" &&
      value.activationState !== "failed") {
      context.addIssue({
        code: "custom",
        path: ["availableActions"],
        message: "device activation can only start from a ready or failed state",
      });
    }
  }
  if (value.step === "initial_import") {
    const completed = value.importState === "completed";
    const summary = [value.importedDomains, value.importedListings, value.conflicts, value.baselineServerRevision];
    if (completed !== summary.every((entry) => entry !== null)) {
      context.addIssue({ code: "custom", path: ["importState"], message: "completion requires a full summary" });
    }
    if (value.importState === "in_progress" && value.progress >= 100) {
      context.addIssue({ code: "custom", path: ["progress"], message: "in-progress import is not complete" });
    }
  }
});

export type ActivationWizardSnapshot = z.infer<typeof activationWizardSnapshotSchema>;
export type ActivationWizardViewModel = ActivationWizardSnapshot;
export type ActivationAction = z.infer<typeof activationActionSchema>;
export type HostDeviceIdentityProjection = z.infer<typeof hostDeviceIdentityProjectionSchema>;
export type ActiveDeviceLeaseProjection = z.infer<typeof activeDeviceLeaseProjectionSchema>;

export function projectActivationWizardViewModel(input: unknown): ProjectionResult<ActivationWizardViewModel> {
  return projectStrict(activationWizardSnapshotSchema, input, (value) => ({
    ...value,
    availableActions: [...value.availableActions],
    ...(value.step === "connections" ? { providers: value.providers.map((provider) => ({ ...provider })) } : {}),
  }) as ActivationWizardViewModel);
}

const forcedSwitchActionSchema = z.enum([
  "acknowledge_risk",
  "request_switch",
  "cancel_switch",
  "open_manual_platform",
  "copy_affected_domains",
]);

export const forcedSwitchSnapshotSchema = z.discriminatedUnion("stage", [
  z.object({
    stage: z.literal("request_confirmation"),
    oldDeviceDisplay: displayText,
    lastOnlineDisplay: displayText,
    acknowledged: z.boolean(),
    availableActions: z.array(forcedSwitchActionSchema).max(5),
  }).strict(),
  z.object({
    stage: z.literal("isolation_wait"),
    oldDeviceDisplay: displayText,
    lastOnlineDisplay: displayText,
    earliestTakeoverAt: canonicalUtcTimestamp,
    earliestTakeoverDisplay: displayText,
    remainingDisplay: displayText,
    estimatedRecoveryItems: safeCount,
    emergencyAffectedDisplay: optionalDisplayText,
    availableActions: z.array(forcedSwitchActionSchema).max(5),
  }).strict(),
]).superRefine((value, context) => {
  const allowed = value.stage === "request_confirmation"
    ? ["acknowledge_risk", "request_switch", "cancel_switch"] as const
    : ["cancel_switch", "open_manual_platform", "copy_affected_domains"] as const;
  if (value.availableActions.some((action) => !(allowed as readonly ForcedSwitchAction[]).includes(action))) {
    context.addIssue({ code: "custom", path: ["availableActions"], message: "action is unavailable for the forced-switch stage" });
  }
  if (
    value.stage === "request_confirmation" &&
    value.availableActions.includes("request_switch") &&
    !value.acknowledged
  ) {
    context.addIssue({
      code: "custom",
      path: ["availableActions"],
      message: "forced switch cannot be requested before acknowledgement",
    });
  }
  if (
    value.stage === "isolation_wait" &&
    value.emergencyAffectedDisplay === null &&
    value.availableActions.some((action) => action === "open_manual_platform" || action === "copy_affected_domains")
  ) {
    context.addIssue({
      code: "custom",
      path: ["availableActions"],
      message: "manual fallback requires an affected-resource projection",
    });
  }
});

export type ForcedSwitchSnapshot = z.infer<typeof forcedSwitchSnapshotSchema>;
export type ForcedSwitchViewModel = ForcedSwitchSnapshot;
export type ForcedSwitchAction = z.infer<typeof forcedSwitchActionSchema>;

export function projectForcedSwitchViewModel(input: unknown): ProjectionResult<ForcedSwitchViewModel> {
  return projectStrict(forcedSwitchSnapshotSchema, input, (value) => ({
    ...value,
    availableActions: [...value.availableActions],
  }));
}

const axisStatusSchema = z.enum(["reachable", "unreachable"]);
const providerCapabilitySchema = z.object({
  providerId: identifier,
  displayName: displayText,
  status: axisStatusSchema,
  canRead: z.boolean(),
  canSubmit: z.boolean(),
  canConfirm: z.boolean(),
}).strict();

export const networkCapabilitySnapshotSchema = z.object({
  deviceStatus: axisStatusSchema,
  cloudStatus: axisStatusSchema,
  cloudCanSync: z.boolean(),
  cloudCanSwitchDevice: z.boolean(),
  localCanViewAssets: z.boolean(),
  localCanEditDesiredState: z.boolean(),
  localCanPreparePlans: z.boolean(),
  providers: z.array(providerCapabilitySchema).max(64),
  offlineExecutionWindow: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("unavailable") }).strict(),
    z.object({ kind: z.literal("adjudicated"), remainingDisplay: displayText }).strict(),
  ]),
}).strict().superRefine((value, context) => {
  const ids = value.providers.map(({ providerId }) => providerId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["providers"], message: "provider ids must be unique" });
  }
  if (
    value.offlineExecutionWindow.kind === "adjudicated" &&
    (value.deviceStatus !== "reachable" || value.cloudStatus !== "unreachable")
  ) {
    context.addIssue({
      code: "custom",
      path: ["offlineExecutionWindow"],
      message: "offline execution display requires device reachability and cloud failure",
    });
  }
});

export type NetworkCapabilitySnapshot = z.infer<typeof networkCapabilitySnapshotSchema>;

export interface NetworkCapabilityViewModel {
  readonly deviceStatus: z.infer<typeof axisStatusSchema>;
  readonly cloudStatus: z.infer<typeof axisStatusSchema>;
  readonly cloudCanSync: boolean;
  readonly cloudCanSwitchDevice: boolean;
  readonly localCanViewAssets: boolean;
  readonly localCanEditDesiredState: boolean;
  readonly localCanPreparePlans: boolean;
  readonly providers: readonly z.infer<typeof providerCapabilitySchema>[];
  readonly offlineExecutionWindow: z.infer<typeof networkCapabilitySnapshotSchema>["offlineExecutionWindow"];
  readonly degradation: "healthy" | "warning" | "danger";
  readonly reasons: readonly ("device_unreachable" | "cloud_unreachable" | "provider_unreachable")[];
}

/** Reduces adjudicated capability flags by reachability and never turns false into true. */
export function projectNetworkCapabilityViewModel(input: unknown): ProjectionResult<NetworkCapabilityViewModel> {
  return projectStrict(networkCapabilitySnapshotSchema, input, (value) => {
    const deviceReachable = value.deviceStatus === "reachable";
    const cloudReachable = value.cloudStatus === "reachable";
    const cloudAvailable = deviceReachable && cloudReachable;
    const providerAuthorityAvailable = cloudAvailable || value.offlineExecutionWindow.kind === "adjudicated";
    const providers = value.providers.map((provider) => {
      const reachable = provider.status === "reachable";
      const providerAvailable = deviceReachable && reachable;
      return {
        ...provider,
        canRead: providerAvailable && providerAuthorityAvailable && provider.canRead,
        canSubmit: providerAvailable && providerAuthorityAvailable && provider.canSubmit,
        canConfirm: providerAvailable && providerAuthorityAvailable && provider.canConfirm,
      };
    });
    const providerFailures = providers.filter(({ status }) => status === "unreachable");
    const reasons: NetworkCapabilityViewModel["reasons"] = [
      ...(deviceReachable ? [] : ["device_unreachable" as const]),
      ...(cloudReachable ? [] : ["cloud_unreachable" as const]),
      ...(providerFailures.length === 0 ? [] : ["provider_unreachable" as const]),
    ];

    return {
      deviceStatus: value.deviceStatus,
      cloudStatus: value.cloudStatus,
      cloudCanSync: cloudAvailable && value.cloudCanSync,
      cloudCanSwitchDevice: cloudAvailable && value.cloudCanSwitchDevice,
      localCanViewAssets: value.localCanViewAssets,
      localCanEditDesiredState: value.localCanEditDesiredState,
      localCanPreparePlans: value.localCanPreparePlans,
      providers,
      offlineExecutionWindow: deviceReachable && !cloudReachable
        ? value.offlineExecutionWindow
        : { kind: "unavailable" },
      degradation: !deviceReachable
        ? "danger"
        : !cloudReachable || providerFailures.length > 0
          ? "warning"
          : "healthy",
      reasons,
    };
  });
}

const drainStreamSchema = z.object({
  stream: z.enum(["mutations", "execution_facts", "workspace_device_audit"]),
  acknowledgedSequence: safeCount,
  pendingCount: safeCount,
  gapCount: safeCount,
}).strict();

export const drainingSnapshotSchema = z.object({
  reason: z.enum(["handoff", "suspend"]),
  phase: z.enum(["stopping_work", "isolating_submissions", "uploading_envelopes", "verifying_manifest", "complete", "failed"]),
  streams: z.array(drainStreamSchema).length(3),
  canCancel: z.boolean(),
  failureReference: identifier.nullable(),
}).strict().superRefine((value, context) => {
  const kinds = value.streams.map(({ stream }) => stream);
  if (new Set(kinds).size !== 3) {
    context.addIssue({ code: "custom", path: ["streams"], message: "all drain streams are required exactly once" });
  }
  if ((value.phase === "failed") !== (value.failureReference !== null)) {
    context.addIssue({ code: "custom", path: ["failureReference"], message: "failure reference must agree" });
  }
});

export type DrainingSnapshot = z.infer<typeof drainingSnapshotSchema>;
export type DrainingViewModel = DrainingSnapshot & {
  readonly businessActionsAvailable: false;
};

export function projectDrainingViewModel(input: unknown): ProjectionResult<DrainingViewModel> {
  return projectStrict(drainingSnapshotSchema, input, (value) => ({
    ...value,
    streams: value.streams.map((stream) => ({ ...stream })),
    businessActionsAvailable: false,
  }));
}

export const localContinuationSnapshotSchema = z.object({
  artifactDisplay: displayText,
  authorizationState: z.literal("unavailable"),
  workspaceState: z.enum(["not_initialized", "read_only"]),
}).strict();

export type LocalContinuationSnapshot = z.infer<typeof localContinuationSnapshotSchema>;

export interface LocalContinuationViewModel extends LocalContinuationSnapshot {
  readonly cloudAvailable: false;
  readonly accountRequired: false;
  readonly businessActions: readonly [];
}

/** Current production intentionally has no Sunset capability derivation or consumption chain. */
export function projectLocalContinuationViewModel(input: unknown): ProjectionResult<LocalContinuationViewModel> {
  return projectStrict(localContinuationSnapshotSchema, input, (value) => ({
    ...value,
    cloudAvailable: false,
    accountRequired: false,
    businessActions: [],
  }));
}
