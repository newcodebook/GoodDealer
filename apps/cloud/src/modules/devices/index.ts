import {
  ACCOUNT_REJECTION_SCHEMA_VERSION,
  accountRejectionSchema,
  type AccountRejection,
  type AccountRejectionCode,
} from "@gooddealer/protocol/account";
import {
  DEVICE_MANAGEMENT_SCHEMA_VERSION,
  activeDeviceLeaseStatusSchema,
  deviceBindingListSchema,
  deviceBindingSummarySchema,
  deviceSwitchRequestViewSchema,
  type ActiveDeviceLeaseStatus,
  type DeviceBindingList,
  type DeviceBindingSummary,
  type DeviceRemovalRequest,
  type DeviceSwitchRequest,
  type DeviceSwitchRequestView,
} from "@gooddealer/protocol/devices";

interface LeaseRecord {
  readonly deviceId: string;
  readonly leaseEpoch: number;
  readonly issuedAt: string;
  readonly renewAfter: string;
  readonly onlineExpiresAt: string;
  readonly offlineExecuteUntil: string;
}

interface StoredSwitch {
  readonly idempotencyKey: string;
  readonly view: DeviceSwitchRequestView;
}

export interface DeviceFixtureOptions {
  readonly now?: () => Date;
  readonly reauthCheck?: (reauthProofId: string) => AccountRejection | null;
  readonly seedBindings?: readonly DeviceBindingSummary[];
  readonly activeLease?: LeaseRecord | null;
}

export class DevicesFixtureService {
  #listRevision = 1;
  #nextSwitch = 1;
  #activeLease: LeaseRecord | null;
  #exclusiveExecutionBlockUntil: string | null = null;
  #outstandingSwitch: StoredSwitch | null = null;
  readonly #now: () => Date;
  readonly #reauthCheck: (reauthProofId: string) => AccountRejection | null;
  readonly #bindings = new Map<string, DeviceBindingSummary>();

  constructor(options: DeviceFixtureOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#reauthCheck = options.reauthCheck ?? (() => this.#reject("REAUTHENTICATION_REQUIRED"));
    this.#activeLease = options.activeLease ?? null;
    for (const binding of options.seedBindings ?? []) {
      this.#bindings.set(binding.deviceId, deviceBindingSummarySchema.parse(binding));
    }
    this.#assertDirectoryInvariant();
  }

  listBindings(): DeviceBindingList {
    return deviceBindingListSchema.parse({
      schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
      listRevision: this.#listRevision,
      devices: [...this.#bindings.values()],
    });
  }

  bindDevice(binding: DeviceBindingSummary): DeviceBindingList | AccountRejection {
    const parsed = deviceBindingSummarySchema.parse(binding);
    const existing = this.#bindings.get(parsed.deviceId);
    const boundCount = [...this.#bindings.values()].filter(({ status }) => status === "bound").length;
    if (parsed.status === "bound" && existing?.status !== "bound" && boundCount >= 2) {
      return this.#reject("DEVICE_LIMIT_REACHED");
    }
    const otherActive = [...this.#bindings.values()].some(
      ({ deviceId, role }) => deviceId !== parsed.deviceId && role === "active",
    );
    if (parsed.role === "active" && otherActive) return this.#reject("ACTIVE_DEVICE_CONFLICT");
    const otherCurrentDevice = [...this.#bindings.values()].some(
      ({ deviceId, currentDevice }) => deviceId !== parsed.deviceId && currentDevice,
    );
    if (parsed.currentDevice && otherCurrentDevice) return this.#reject("ACTIVE_DEVICE_CONFLICT");

    deviceBindingListSchema.parse({
      schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
      listRevision: this.#listRevision + 1,
      devices: [...this.#bindings.values()].filter(({ deviceId }) => deviceId !== parsed.deviceId).concat(parsed),
    });
    this.#bindings.set(parsed.deviceId, parsed);
    this.#listRevision += 1;
    return this.listBindings();
  }

  removeDevice(request: DeviceRemovalRequest): DeviceBindingList | AccountRejection {
    if (request.expectedListRevision !== this.#listRevision) return this.#reject("LIST_REVISION_STALE");
    const binding = this.#bindings.get(request.deviceId);
    if (binding === undefined) return this.#reject("DEVICE_NOT_BOUND");
    if (binding.status === "removed") return this.#reject("DEVICE_REMOVED");
    if (request.expectedCredentialEpoch !== binding.credentialEpoch) {
      return this.#reject("LIST_REVISION_STALE");
    }
    const proofFailure = this.#reauthCheck(request.reauthProofId);
    if (proofFailure !== null) return proofFailure;

    const removedAt = this.#timestamp();
    const removedWasActive = binding.role === "active";
    this.#bindings.set(
      binding.deviceId,
      deviceBindingSummarySchema.parse({
        ...binding,
        status: "removed",
        role: "none",
        credentialEpoch: binding.credentialEpoch + 1,
        signingKeyStatus: "revoked",
        removedAt,
        currentDevice: false,
      }),
    );
    this.#listRevision += 1;
    if (removedWasActive && this.#activeLease?.deviceId === binding.deviceId) {
      this.#exclusiveExecutionBlockUntil = this.#activeLease.offlineExecuteUntil;
      this.#activeLease = null;
    }
    return this.listBindings();
  }

  advanceCredentialEpoch(deviceId: string): DeviceBindingList | AccountRejection {
    const binding = this.#bindings.get(deviceId);
    if (binding === undefined) return this.#reject("DEVICE_NOT_BOUND");
    if (binding.status === "removed") return this.#reject("DEVICE_REMOVED");
    this.#bindings.set(binding.deviceId, deviceBindingSummarySchema.parse({ ...binding, credentialEpoch: binding.credentialEpoch + 1 }));
    this.#listRevision += 1;
    return this.listBindings();
  }

  getLeaseStatus(evaluatedAt = this.#timestamp()): ActiveDeviceLeaseStatus {
    const lease = this.#activeLease;
    if (lease === null) {
      return activeDeviceLeaseStatusSchema.parse({
        schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
        held: false,
        deviceId: null,
        leaseEpoch: null,
        issuedAt: null,
        renewAfter: null,
        onlineExpiresAt: null,
        offlineExecuteUntil: null,
        renewalState: "expired",
        evaluatedAt,
      });
    }
    const renewalState =
      evaluatedAt < lease.renewAfter
        ? "fresh"
        : evaluatedAt < lease.onlineExpiresAt
          ? "renewal_window"
          : evaluatedAt < lease.offlineExecuteUntil
            ? "offline_grace"
            : "expired";
    return activeDeviceLeaseStatusSchema.parse({
      schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
      held: true,
      ...lease,
      renewalState,
      evaluatedAt,
    });
  }

  requestSwitch(request: DeviceSwitchRequest): DeviceSwitchRequestView | AccountRejection {
    if (this.#outstandingSwitch?.idempotencyKey === request.idempotencyKey) {
      return this.#outstandingSwitch.view;
    }
    if (this.#outstandingSwitch !== null && !isTerminal(this.#outstandingSwitch.view.status)) {
      return this.#reject("ACTIVE_DEVICE_CONFLICT");
    }
    const target = this.#bindings.get(request.toDeviceId);
    if (target === undefined) return this.#reject("DEVICE_NOT_BOUND");
    if (target.status === "removed") return this.#reject("DEVICE_REMOVED");
    if (request.mode === "forced") {
      const proofFailure = this.#reauthCheck(request.reauthProofId);
      if (proofFailure !== null) return proofFailure;
    }

    const requestedAt = this.#timestamp();
    if (this.#exclusiveExecutionBlockUntil !== null && requestedAt < this.#exclusiveExecutionBlockUntil) {
      return this.#reject("EXCLUSIVE_EXECUTION_BLOCKED");
    }
    const fromDeviceId = [...this.#bindings.values()].find(({ role }) => role === "active")?.deviceId ?? null;
    const earliestTakeoverAt =
      request.mode === "forced" && this.#exclusiveExecutionBlockUntil !== null && requestedAt < this.#exclusiveExecutionBlockUntil
        ? this.#exclusiveExecutionBlockUntil
        : request.mode === "forced"
          ? requestedAt
          : null;
    const view = deviceSwitchRequestViewSchema.parse({
      schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
      requestId: `fixture-switch-${this.#nextSwitch++}`,
      mode: request.mode,
      status: fromDeviceId === null ? "requested" : "draining",
      fromDeviceId,
      toDeviceId: request.toDeviceId,
      requestedAt,
      earliestTakeoverAt,
      bootstrapExpiresAt: null,
    });
    this.#outstandingSwitch = { idempotencyKey: request.idempotencyKey, view };
    return view;
  }

  #assertDirectoryInvariant(): void {
    deviceBindingListSchema.parse({
      schemaVersion: DEVICE_MANAGEMENT_SCHEMA_VERSION,
      listRevision: this.#listRevision,
      devices: [...this.#bindings.values()],
    });
  }

  #reject(code: AccountRejectionCode): AccountRejection {
    const retryable = ["LIST_REVISION_STALE", "ACTIVE_DEVICE_CONFLICT"].includes(code);
    return accountRejectionSchema.parse({
      schemaVersion: ACCOUNT_REJECTION_SCHEMA_VERSION,
      code,
      retryable,
      retryAfterSeconds: null,
      correlationId: `fixture-devices-${code.toLowerCase()}`,
    });
  }

  #timestamp(): string {
    return this.#now().toISOString().replace(/\.\d{3}Z$/, "Z");
  }
}

function isTerminal(status: DeviceSwitchRequestView["status"]): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}
