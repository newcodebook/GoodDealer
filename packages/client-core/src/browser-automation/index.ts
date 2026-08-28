import { z } from "zod";

const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const sha256DigestSchema = z.string().length(64).regex(/^[a-f0-9]+$/);
const hostPatternSchema = z
  .string()
  .min(4)
  .max(253)
  .regex(/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
const domainNameSchema = z
  .string()
  .min(4)
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);

function addUniqueArrayIssue(
  values: readonly string[],
  path: readonly (string | number)[],
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path: [...path], message: "values must be unique" });
  }
}

function addChronologyIssue(
  issuedAt: string,
  expiresAt: string,
  context: z.RefinementCtx,
): void {
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "expiry must be later than issuance",
    });
  }
}

export const browserSessionConsentSchema = z
  .object({
    schemaVersion: z.literal(1),
    consentRequestId: identifierSchema,
    providerConnectionId: identifierSchema,
    browserSessionId: identifierSchema,
    provider: z.string().min(1).max(80),
    accountAlias: z.string().min(1).max(120),
    purpose: z.enum(["login", "acquire_api_key", "repair_connection"]),
    allowedAuthHosts: z.array(hostPatternSchema).min(1).max(20),
    sessionMode: z.enum(["persistent", "private"]),
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((consent, context) => {
    addUniqueArrayIssue(consent.allowedAuthHosts, ["allowedAuthHosts"], context);
    addChronologyIssue(consent.issuedAt, consent.expiresAt, context);
  });

const unavailableAdmissionSchema = z
  .object({
    status: z.literal("unavailable"),
    reason: z.enum(["gate_unproven", "expired", "closed", "host_unavailable"]),
  })
  .strict();

const consentAdmissionSchema = z
  .object({ status: z.literal("proven"), action: z.literal("record_consent_and_open") })
  .strict();

const continueToCaptureAdmissionSchema = z
  .object({ status: z.literal("proven"), action: z.literal("continue_to_native_capture") })
  .strict();

const sessionConsentReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("session_consent"),
    phase: z.literal("review"),
    consent: browserSessionConsentSchema,
    admission: z.discriminatedUnion("status", [unavailableAdmissionSchema, consentAdmissionSchema]),
  })
  .strict();

const sessionConsentUserOperationSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("session_consent"),
    phase: z.literal("user_operation"),
    consent: browserSessionConsentSchema,
    loginState: z.enum(["awaiting_user", "login_observed", "closed", "expired"]),
    admission: z.discriminatedUnion("status", [
      unavailableAdmissionSchema,
      continueToCaptureAdmissionSchema,
    ]),
  })
  .strict()
  .superRefine((view, context) => {
    if (view.admission.status === "proven" && view.loginState !== "login_observed") {
      context.addIssue({
        code: "custom",
        path: ["admission"],
        message: "native capture requires an observed login state",
      });
    }
  });

const nativeCaptureUnavailableSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("native_secret_capture"),
    phase: z.literal("unavailable"),
    nativeCaptureRequestId: identifierSchema,
    providerConnectionId: identifierSchema,
    provider: z.string().min(1).max(80),
    accountAlias: z.string().min(1).max(120),
    credentialLabel: z.string().min(1).max(80),
    admission: unavailableAdmissionSchema,
  })
  .strict();

const nativeCaptureReadySchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("native_secret_capture"),
    phase: z.literal("ready"),
    nativeCaptureRequestId: identifierSchema,
    providerConnectionId: identifierSchema,
    provider: z.string().min(1).max(80),
    accountAlias: z.string().min(1).max(120),
    credentialLabel: z.string().min(1).max(80),
    admission: z.object({ status: z.literal("proven"), action: z.literal("open_native_capture") }).strict(),
  })
  .strict();

const nativeCaptureRecordedSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("native_secret_capture"),
    phase: z.literal("recorded"),
    nativeCaptureRequestId: identifierSchema,
    providerConnectionId: identifierSchema,
    provider: z.string().min(1).max(80),
    accountAlias: z.string().min(1).max(120),
    credentialLabel: z.string().min(1).max(80),
    receiptId: identifierSchema,
    redactedFingerprint: z.string().min(1).max(80),
  })
  .strict();

export const browserAutomationGrantSchema = z
  .object({
    schemaVersion: z.literal(1),
    grantRequestId: identifierSchema,
    providerConnectionId: identifierSchema,
    browserSessionId: identifierSchema,
    operationPlanId: identifierSchema,
    approvedPlanHash: sha256DigestSchema,
    provider: z.string().min(1).max(80),
    accountAlias: z.string().min(1).max(120),
    planItemCount: z.number().int().positive().max(10_000),
    planActionLabel: z.string().min(1).max(160),
    allowedActions: z
      .array(z.enum(["click", "fill", "upload_csv", "read_result"]))
      .min(1)
      .max(12),
    targetDomains: z.array(domainNameSchema).min(1).max(10_000),
    allowedHosts: z.array(hostPatternSchema).min(1).max(20),
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    requiresFinalConfirmation: z.boolean(),
  })
  .strict()
  .superRefine((grant, context) => {
    addUniqueArrayIssue(grant.allowedActions, ["allowedActions"], context);
    addUniqueArrayIssue(grant.targetDomains, ["targetDomains"], context);
    addUniqueArrayIssue(grant.allowedHosts, ["allowedHosts"], context);
    addChronologyIssue(grant.issuedAt, grant.expiresAt, context);
  });

const grantReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("execution_grant"),
    phase: z.literal("review"),
    grant: browserAutomationGrantSchema,
    admission: z.discriminatedUnion("status", [
      unavailableAdmissionSchema,
      z.object({ status: z.literal("proven"), action: z.literal("record_grant") }).strict(),
    ]),
  })
  .strict();

const grantRecordedSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("execution_grant"),
    phase: z.literal("recorded"),
    grant: browserAutomationGrantSchema,
    grantReceiptId: identifierSchema,
  })
  .strict();

export const browserExecutionTaskSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: identifierSchema,
    providerConnectionId: identifierSchema,
    browserSessionId: identifierSchema,
    provider: z.string().min(1).max(80),
    accountAlias: z.string().min(1).max(120),
    allowedHosts: z.array(hostPatternSchema).min(1).max(20),
    operator: z.enum(["user", "software"]),
    state: z.enum([
      "awaiting_user",
      "running",
      "paused",
      "outcome_unknown",
      "finished",
      "terminated",
    ]),
    nextStepLabel: z.string().min(1).max(200),
    remainingItems: z.number().int().min(0).max(10_000),
    controlAdmission: z.discriminatedUnion("status", [
      unavailableAdmissionSchema,
      z
        .object({
          status: z.literal("proven"),
          controls: z
            .array(z.enum(["pause_and_take_over", "continue", "terminate"]))
            .min(1)
            .max(3),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((task, context) => {
    addUniqueArrayIssue(task.allowedHosts, ["allowedHosts"], context);
    const controls = task.controlAdmission.status === "proven"
      ? task.controlAdmission.controls
      : [];
    if (new Set(controls).size !== controls.length) {
      context.addIssue({
        code: "custom",
        path: ["controlAdmission", "controls"],
        message: "controls must be unique",
      });
    }
    const allowed =
      task.state === "running"
        ? new Set(["pause_and_take_over", "terminate"])
        : task.state === "paused" || task.state === "awaiting_user"
          ? new Set(["continue", "terminate"])
          : new Set<string>();
    if (controls.some((control) => !allowed.has(control))) {
      context.addIssue({
        code: "custom",
        path: ["controlAdmission", "controls"],
        message: "task controls do not match the task state",
      });
    }
    if (task.operator === "software" && task.state !== "running") {
      context.addIssue({
        code: "custom",
        path: ["operator"],
        message: "software may only be the displayed operator while running",
      });
    }
  });

const executionTaskViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("execution_grant"),
    phase: z.literal("task"),
    grantReceiptId: identifierSchema,
    task: browserExecutionTaskSchema,
  })
  .strict();

export const browserHandoffViewModelSchema = z.discriminatedUnion("mode", [
  z.discriminatedUnion("phase", [sessionConsentReviewSchema, sessionConsentUserOperationSchema]),
  z.discriminatedUnion("phase", [
    nativeCaptureUnavailableSchema,
    nativeCaptureReadySchema,
    nativeCaptureRecordedSchema,
  ]),
  z.discriminatedUnion("phase", [grantReviewSchema, grantRecordedSchema, executionTaskViewSchema]),
]);

export const sessionConsentReceiptSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("recorded"), receiptId: identifierSchema }).strict(),
  z.object({ outcome: z.literal("cancelled") }).strict(),
  z.object({ outcome: z.literal("unavailable") }).strict(),
]);

export const nativeSecretCaptureReceiptSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("recorded"),
      receiptId: identifierSchema,
      redactedFingerprint: z.string().min(1).max(80),
    })
    .strict(),
  z.object({ outcome: z.literal("cancelled") }).strict(),
  z.object({ outcome: z.literal("unavailable") }).strict(),
]);

export const automationGrantReceiptSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("recorded"), receiptId: identifierSchema }).strict(),
  z.object({ outcome: z.literal("cancelled") }).strict(),
  z.object({ outcome: z.literal("unavailable") }).strict(),
]);

export const browserExecutionControlReceiptSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("recorded"), controlRequestId: identifierSchema }).strict(),
  z.object({ outcome: z.literal("cancelled") }).strict(),
  z.object({ outcome: z.literal("unavailable") }).strict(),
]);

export type BrowserSessionConsent = z.infer<typeof browserSessionConsentSchema>;
export type BrowserAutomationGrant = z.infer<typeof browserAutomationGrantSchema>;
export type BrowserExecutionTaskViewModel = z.infer<typeof browserExecutionTaskSchema>;
export type BrowserHandoffViewModel = z.infer<typeof browserHandoffViewModelSchema>;
export type SessionConsentReceipt = z.infer<typeof sessionConsentReceiptSchema>;
export type NativeSecretCaptureReceipt = z.infer<typeof nativeSecretCaptureReceiptSchema>;
export type AutomationGrantReceipt = z.infer<typeof automationGrantReceiptSchema>;
export type BrowserExecutionControlReceipt = z.infer<typeof browserExecutionControlReceiptSchema>;
export type BrowserExecutionControl = Extract<
  BrowserExecutionTaskViewModel["controlAdmission"],
  { readonly status: "proven" }
>["controls"][number];

export interface RecordBrowserSessionConsentCommand {
  readonly kind: "record_browser_session_consent";
  readonly consentRequestId: string;
}

/** This opaque request identifier is the entire TypeScript-visible native capture command. */
export interface OpenNativeSecretCaptureCommand {
  readonly kind: "open_native_secret_capture";
  readonly nativeCaptureRequestId: string;
}

export interface RecordBrowserAutomationGrantCommand {
  readonly kind: "record_browser_automation_grant";
  readonly grantRequestId: string;
}

export interface BrowserSessionConsentPort {
  recordConsent(command: RecordBrowserSessionConsentCommand): Promise<SessionConsentReceipt>;
}

export interface BrowserSessionConsentBoundary {
  recordConsent(command: RecordBrowserSessionConsentCommand): Promise<unknown>;
}

export interface NativeSecretCapturePort {
  openNativeCapture(command: OpenNativeSecretCaptureCommand): Promise<NativeSecretCaptureReceipt>;
}

export interface NativeSecretCaptureBoundary {
  openNativeCapture(command: OpenNativeSecretCaptureCommand): Promise<unknown>;
}

export interface BrowserAutomationGrantPort {
  recordGrant(command: RecordBrowserAutomationGrantCommand): Promise<AutomationGrantReceipt>;
}

export interface BrowserAutomationGrantBoundary {
  recordGrant(command: RecordBrowserAutomationGrantCommand): Promise<unknown>;
}

export interface BrowserExecutionControlPort {
  requestControl(
    taskId: string,
    control: BrowserExecutionControl,
  ): Promise<BrowserExecutionControlReceipt>;
}

export interface BrowserExecutionControlBoundary {
  requestControl(taskId: string, control: BrowserExecutionControl): Promise<unknown>;
}

export function parseBrowserHandoffViewModel(input: unknown): BrowserHandoffViewModel {
  return parseWithoutEcho(browserHandoffViewModelSchema, input, "invalid browser handoff projection");
}

export function parseBrowserExecutionTask(input: unknown): BrowserExecutionTaskViewModel {
  return parseWithoutEcho(browserExecutionTaskSchema, input, "invalid browser execution task projection");
}

export function parseSessionConsentReceipt(input: unknown): SessionConsentReceipt {
  return parseWithoutEcho(sessionConsentReceiptSchema, input, "invalid session consent receipt");
}

export function parseNativeSecretCaptureReceipt(input: unknown): NativeSecretCaptureReceipt {
  return parseWithoutEcho(nativeSecretCaptureReceiptSchema, input, "invalid native capture receipt");
}

export function parseAutomationGrantReceipt(input: unknown): AutomationGrantReceipt {
  return parseWithoutEcho(automationGrantReceiptSchema, input, "invalid automation grant receipt");
}

export function parseBrowserExecutionControlReceipt(
  input: unknown,
): BrowserExecutionControlReceipt {
  return parseWithoutEcho(
    browserExecutionControlReceiptSchema,
    input,
    "invalid browser execution control receipt",
  );
}

/** Portable strict adapters only; no Host, WebView, persistence, or execution wiring. */
export class ValidatingBrowserSessionConsentPort implements BrowserSessionConsentPort {
  readonly #boundary: BrowserSessionConsentBoundary;

  constructor(boundary: BrowserSessionConsentBoundary) {
    this.#boundary = boundary;
  }

  async recordConsent(command: RecordBrowserSessionConsentCommand): Promise<SessionConsentReceipt> {
    return parseSessionConsentReceipt(await this.#boundary.recordConsent(command));
  }
}

export class ValidatingNativeSecretCapturePort implements NativeSecretCapturePort {
  readonly #boundary: NativeSecretCaptureBoundary;

  constructor(boundary: NativeSecretCaptureBoundary) {
    this.#boundary = boundary;
  }

  async openNativeCapture(
    command: OpenNativeSecretCaptureCommand,
  ): Promise<NativeSecretCaptureReceipt> {
    return parseNativeSecretCaptureReceipt(await this.#boundary.openNativeCapture(command));
  }
}

export class ValidatingBrowserAutomationGrantPort implements BrowserAutomationGrantPort {
  readonly #boundary: BrowserAutomationGrantBoundary;

  constructor(boundary: BrowserAutomationGrantBoundary) {
    this.#boundary = boundary;
  }

  async recordGrant(
    command: RecordBrowserAutomationGrantCommand,
  ): Promise<AutomationGrantReceipt> {
    return parseAutomationGrantReceipt(await this.#boundary.recordGrant(command));
  }
}

export class ValidatingBrowserExecutionControlPort implements BrowserExecutionControlPort {
  readonly #boundary: BrowserExecutionControlBoundary;

  constructor(boundary: BrowserExecutionControlBoundary) {
    this.#boundary = boundary;
  }

  async requestControl(
    taskId: string,
    control: BrowserExecutionControl,
  ): Promise<BrowserExecutionControlReceipt> {
    return parseBrowserExecutionControlReceipt(await this.#boundary.requestControl(taskId, control));
  }
}

function parseWithoutEcho<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
  message: string,
): z.infer<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    // Boundary errors are intentionally value-free: secret-like unexpected input must
    // never be copied into logs, diagnostics, persistence, or an Error message.
    throw new TypeError(message);
  }
  return parsed.data;
}
