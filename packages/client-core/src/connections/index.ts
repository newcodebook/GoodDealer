import { z } from "zod";

export * from "./device-credential-lifecycle";

const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const safePositiveGenerationSchema = z.number().int().safe().min(1);

export const redactedCredentialBindingStatusSchema = z
  .object({
    schemaVersion: z.literal(1),
    bindingId: identifierSchema,
    providerConnectionId: identifierSchema,
    deviceId: identifierSchema,
    provider: z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    credentialProfileId: identifierSchema,
    credentialProfileVersion: z.number().int().min(1).max(4_294_967_295),
    fingerprint: z.string().min(8).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    credentialHealth: z.enum([
      "verifying",
      "retained_unverified",
      "healthy",
      "invalid",
      "action_required",
      "revoked",
    ]),
    healthGeneration: safePositiveGenerationSchema,
    bindingVersion: safePositiveGenerationSchema,
  })
  .strict();

export const providerConnectionHealthSchema = z.enum([
  "unconfigured",
  "capturing",
  "authenticating",
  "verifying",
  "healthy",
  "retained_unverified",
  "invalid",
  "action_required",
  "revoked",
]);

export const deviceCredentialCandidateStateSchema = z.enum([
  "never_configured",
  "configured_candidate",
  "unknown",
]);

export const connectionSettingsActionSchema = z.enum(["connect", "reauthorize", "manage"]);

const connectionMetadataSchema = z
  .object({
    providerConnectionId: identifierSchema,
    provider: z.string().min(1).max(80),
    accountAlias: z.string().min(1).max(120),
    remoteAccountId: z.string().min(1).max(160).nullable(),
    category: z.enum(["registrar", "dns", "marketplace"]),
    method: z.enum(["api", "browser", "csv", "oauth"]).nullable(),
    summary: z.string().min(1).max(240),
  })
  .strict();

const unavailableActionSchema = z.object({ actionAvailability: z.literal("unavailable") }).strict();
const availableActionSchema = z
  .object({
    actionAvailability: z.literal("available"),
    action: connectionSettingsActionSchema,
  })
  .strict();

const activeConnectionSchema = connectionMetadataSchema
  .extend({
    view: z.literal("active"),
    credentialHealth: providerConnectionHealthSchema,
    quotaSummary: z.string().min(1).max(160).nullable(),
    lastCheckedAt: z.iso.datetime().nullable(),
    admission: z.discriminatedUnion("actionAvailability", [
      unavailableActionSchema,
      availableActionSchema,
    ]),
  })
  .strict()
  .superRefine((connection, context) => {
    if (connection.admission.actionAvailability !== "available") return;
    const expectedAction =
      connection.credentialHealth === "unconfigured"
        ? "connect"
        : connection.credentialHealth === "healthy"
          ? "manage"
          : connection.credentialHealth === "invalid" ||
              connection.credentialHealth === "action_required" ||
              connection.credentialHealth === "revoked"
            ? "reauthorize"
            : null;
    if (connection.admission.action !== expectedAction) {
      context.addIssue({
        code: "custom",
        path: ["admission", "action"],
        message: "connection action does not match the redacted connection state",
      });
    }
  });

const standbyConnectionSchema = connectionMetadataSchema
  .extend({
    view: z.literal("standby"),
    candidateState: deviceCredentialCandidateStateSchema,
    admission: unavailableActionSchema,
  })
  .strict();

export const connectionSettingsItemSchema = z.discriminatedUnion("view", [
  activeConnectionSchema,
  standbyConnectionSchema,
]);

export const connectionSettingsGroupSchema = z
  .object({
    category: z.enum(["registrar", "dns", "marketplace"]),
    connections: z.array(connectionSettingsItemSchema).max(100),
  })
  .strict()
  .superRefine((group, context) => {
    group.connections.forEach((connection, index) => {
      if (connection.category !== group.category) {
        context.addIssue({
          code: "custom",
          path: ["connections", index, "category"],
          message: "connection category must match its settings group",
        });
      }
    });
  });

export const connectionSettingsViewModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    surface: z.enum(["active", "standby"]),
    groups: z.array(connectionSettingsGroupSchema).min(1).max(3),
  })
  .strict()
  .superRefine((model, context) => {
    const seen = new Set<string>();
    const seenCategories = new Set<string>();
    model.groups.forEach((group, groupIndex) => {
      if (seenCategories.has(group.category)) {
        context.addIssue({
          code: "custom",
          path: ["groups", groupIndex, "category"],
          message: "settings group categories must be unique",
        });
      }
      seenCategories.add(group.category);
      group.connections.forEach((connection, connectionIndex) => {
        if (connection.view !== model.surface) {
          context.addIssue({
            code: "custom",
            path: ["groups", groupIndex, "connections", connectionIndex, "view"],
            message: "connection view must match the settings surface",
          });
        }
        if (seen.has(connection.providerConnectionId)) {
          context.addIssue({
            code: "custom",
            path: ["groups", groupIndex, "connections", connectionIndex, "providerConnectionId"],
            message: "provider connection ids must be unique",
          });
        }
        seen.add(connection.providerConnectionId);
      });
    });
  });

export type ProviderConnectionHealth = z.infer<typeof providerConnectionHealthSchema>;
export type RedactedCredentialBindingStatus = z.infer<
  typeof redactedCredentialBindingStatusSchema
>;
export type DeviceCredentialCandidateState = z.infer<
  typeof deviceCredentialCandidateStateSchema
>;
export type ConnectionSettingsAction = z.infer<typeof connectionSettingsActionSchema>;
export type ConnectionSettingsItemViewModel = z.infer<typeof connectionSettingsItemSchema>;
export type ConnectionSettingsGroupViewModel = z.infer<typeof connectionSettingsGroupSchema>;
export type ConnectionSettingsViewModel = z.infer<typeof connectionSettingsViewModelSchema>;

export interface ConnectionSettingsActionIntent {
  readonly providerConnectionId: string;
  readonly action: ConnectionSettingsAction;
}

/** Read boundary returning only redacted connection projections. */
export interface ConnectionSettingsBoundary {
  getConnectionSettings(): Promise<unknown>;
}

/** Host-independent Port consumed by settings composition. */
export interface ConnectionSettingsPort {
  getConnectionSettings(): Promise<ConnectionSettingsViewModel>;
}

export function parseConnectionSettingsViewModel(input: unknown): ConnectionSettingsViewModel {
  const safeInput = copyBoundedDataGraph(input);
  const parsed = safeInput === null ? null : connectionSettingsViewModelSchema.safeParse(safeInput);
  if (parsed === null || !parsed.success) {
    // Never interpolate untrusted input or Zod issues into ordinary errors: malformed
    // boundaries can contain values that no TypeScript diagnostic should retain.
    throw new TypeError("invalid connection settings projection");
  }
  return parsed.data;
}

/**
 * Parses a Host-produced, local-only presentation status. This projection is deliberately not a
 * protocol type and contains no binding scope, Slot, SecretKind, credential reference, or action
 * authority.
 */
export function parseRedactedCredentialBindingStatus(
  input: unknown,
): RedactedCredentialBindingStatus {
  const safeInput = copyBoundedDataGraph(input);
  const parsed = safeInput === null ? null : redactedCredentialBindingStatusSchema.safeParse(safeInput);
  if (parsed === null || !parsed.success) {
    throw new TypeError("invalid credential binding status");
  }
  return parsed.data;
}

function copyBoundedDataGraph(input: unknown): unknown | null {
  const MAXIMUM_DEPTH = 8;
  const MAXIMUM_ENTRIES = 512;
  const MAXIMUM_ARRAY_LENGTH = 100;
  const MAXIMUM_STRING_LENGTH = 512;
  let entries = 0;

  const copy = (value: unknown, depth: number): unknown | null => {
    if (depth > MAXIMUM_DEPTH || entries >= MAXIMUM_ENTRIES) return null;
    entries += 1;
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") return value.length <= MAXIMUM_STRING_LENGTH ? value : null;
    if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== "object") return null;

    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAXIMUM_ARRAY_LENGTH) {
          return null;
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = Reflect.ownKeys(descriptors);
        if (
          keys.length !== value.length + 1 ||
          keys.some(
            (key) =>
              typeof key !== "string" ||
              (key !== "length" &&
                (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)),
          )
        ) return null;
        const result: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return null;
          const copied = copy(descriptor.value, depth + 1);
          if (copied === null && descriptor.value !== null) return null;
          result.push(copied);
        }
        return result;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return null;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some((key) => typeof key !== "string")) return null;
      const result: Record<string, unknown> = Object.create(null);
      for (const key of keys) {
        if (typeof key !== "string") return null;
        const descriptor = descriptors[key];
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return null;
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

/**
 * Portable validation seam. It performs no network, Keychain, Browser Profile,
 * health check, persistence, or RuntimeMode decision.
 */
export class ValidatingConnectionSettingsPort implements ConnectionSettingsPort {
  readonly #boundary: ConnectionSettingsBoundary;

  constructor(boundary: ConnectionSettingsBoundary) {
    this.#boundary = boundary;
  }

  async getConnectionSettings(): Promise<ConnectionSettingsViewModel> {
    return parseConnectionSettingsViewModel(await this.#boundary.getConnectionSettings());
  }
}
