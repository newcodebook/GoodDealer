import { z } from "zod";

const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const safePositiveGenerationSchema = z.number().int().safe().min(1);

export const deviceCredentialSourceSchema = z.enum(["provider_secret", "browser_session"]);
export const deviceCredentialRequiredActionSchema = z.enum([
  "none",
  "capture_credentials",
  "sign_in",
  "reverify_when_active",
  "unavailable",
]);

export const deviceCredentialLifecycleObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    surface: z.enum(["active", "standby"]),
    providerConnectionId: identifierSchema,
    deviceId: identifierSchema,
    source: deviceCredentialSourceSchema,
    credentialHealth: z.enum([
      "unconfigured",
      "capturing",
      "authenticating",
      "verifying",
      "healthy",
      "retained_unverified",
      "invalid",
      "action_required",
      "revoked",
    ]),
    candidateState: z.enum(["never_configured", "configured_candidate", "unknown"]),
    healthGeneration: safePositiveGenerationSchema,
    bindingVersion: safePositiveGenerationSchema,
    lastCheckedAt: z.iso.datetime().nullable(),
    requiredAction: deviceCredentialRequiredActionSchema,
  })
  .strict()
  .superRefine((observation, context) => {
    const expected = expectedRequiredAction(observation.source, observation.credentialHealth);
    if (observation.requiredAction !== expected) {
      context.addIssue({
        code: "custom",
        path: ["requiredAction"],
        message: "required action does not match the redacted credential state",
      });
    }
    if (
      observation.surface === "standby" &&
      (observation.credentialHealth !== "retained_unverified" ||
        observation.requiredAction !== "reverify_when_active" ||
        observation.lastCheckedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["surface"],
        message: "standby is only a non-authoritative retained candidate projection",
      });
    }
    if (observation.credentialHealth === "healthy" && observation.lastCheckedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["lastCheckedAt"],
        message: "healthy requires a Host observation timestamp",
      });
    }
  });

function expectedRequiredAction(
  source: DeviceCredentialSource,
  health: DeviceCredentialLifecycleObservation["credentialHealth"],
): DeviceCredentialRequiredAction {
  if (health === "healthy") return "none";
  if (health === "retained_unverified") return "reverify_when_active";
  if (source === "provider_secret" && ["unconfigured", "invalid", "revoked"].includes(health)) {
    return "capture_credentials";
  }
  if (
    source === "browser_session" &&
    ["unconfigured", "action_required", "revoked"].includes(health)
  ) {
    return "sign_in";
  }
  return "unavailable";
}

export type DeviceCredentialSource = z.infer<typeof deviceCredentialSourceSchema>;
export type DeviceCredentialRequiredAction = z.infer<
  typeof deviceCredentialRequiredActionSchema
>;
export type DeviceCredentialLifecycleObservation = z.infer<
  typeof deviceCredentialLifecycleObservationSchema
>;

export type DeviceCredentialLifecycleIntent =
  | { readonly kind: "none"; readonly providerConnectionId: string }
  | { readonly kind: "capture_credentials"; readonly providerConnectionId: string }
  | { readonly kind: "sign_in"; readonly providerConnectionId: string }
  | { readonly kind: "reverify_when_active"; readonly providerConnectionId: string }
  | { readonly kind: "unavailable"; readonly providerConnectionId: string };

export interface DeviceCredentialLifecycleBoundary {
  observe(providerConnectionId: string): Promise<unknown>;
}

export interface DeviceCredentialLifecyclePort {
  observe(providerConnectionId: string): Promise<DeviceCredentialLifecycleObservation>;
}

export function parseDeviceCredentialLifecycleObservation(
  input: unknown,
): DeviceCredentialLifecycleObservation {
  const safeInput = copyBoundedOwnData(input);
  const parsed =
    safeInput === null ? null : deviceCredentialLifecycleObservationSchema.safeParse(safeInput);
  if (parsed === null || !parsed.success) {
    throw new TypeError("invalid device credential lifecycle observation");
  }
  return parsed.data;
}

/** Returns presentation intent only; it cannot construct Host health or authority. */
export function planDeviceCredentialLifecycleIntent(
  input: unknown,
): DeviceCredentialLifecycleIntent {
  const observation = parseDeviceCredentialLifecycleObservation(input);
  return {
    kind: observation.requiredAction,
    providerConnectionId: observation.providerConnectionId,
  };
}

export class ValidatingDeviceCredentialLifecyclePort implements DeviceCredentialLifecyclePort {
  readonly #boundary: DeviceCredentialLifecycleBoundary;

  constructor(boundary: DeviceCredentialLifecycleBoundary) {
    this.#boundary = boundary;
  }

  async observe(providerConnectionId: string): Promise<DeviceCredentialLifecycleObservation> {
    if (!identifierSchema.safeParse(providerConnectionId).success) {
      throw new TypeError("invalid provider connection id");
    }
    return parseDeviceCredentialLifecycleObservation(
      await this.#boundary.observe(providerConnectionId),
    );
  }
}

function copyBoundedOwnData(input: unknown): unknown | null {
  const MAXIMUM_DEPTH = 4;
  const MAXIMUM_ENTRIES = 40;
  const MAXIMUM_STRING_LENGTH = 256;
  let entries = 0;

  const copy = (value: unknown, depth: number): unknown | null => {
    if (depth > MAXIMUM_DEPTH || entries >= MAXIMUM_ENTRIES) return null;
    entries += 1;
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") return value.length <= MAXIMUM_STRING_LENGTH ? value : null;
    if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== "object" || Array.isArray(value)) return null;
    try {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return null;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some((key) => typeof key !== "string")) return null;
      const result: Record<string, unknown> = Object.create(null);
      for (const key of keys) {
        if (typeof key !== "string") return null;
        const descriptor = descriptors[key];
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          return null;
        }
        const copied = copy(descriptor.value, depth + 1);
        if (copied === null && descriptor.value !== null) return null;
        result[key] = copied;
      }
      return result;
    } catch {
      return null;
    }
  };

  return copy(input, 0);
}
