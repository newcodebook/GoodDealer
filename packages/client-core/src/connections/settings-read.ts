import { z } from "zod";

import { launchPlatformKindSchema, launchPlatformNames } from "./launch-platforms";
import { copyPlainData, portfolioFreshnessSchema } from "../portfolio/view-models";
import { connectionLabelSchema } from "./connection-label";
import type { ConnectionSettingsItemViewModel, ConnectionSettingsViewModel, ProviderConnectionHealth } from "./index";

const connectionRoleSchema = z.enum(["registrar", "dns", "marketplace"]);

const settingsConnectionRoleSchema = z.object({
  role: connectionRoleSchema,
  // No capability is qualified (ADR-0024) yet, so the Host can only report it as unavailable.
  availability: z.literal("unavailable"),
  unavailableReason: z.literal("qualification_pending"),
}).strict();

const settingsConnectionSchema = z.object({
  providerKind: launchPlatformKindSchema,
  connectionLabel: connectionLabelSchema,
  lifecycleStatus: z.enum(["active", "invalid", "revoked"]),
  validationStatus: z.enum(["unknown", "valid", "invalid", "insufficient_scope", "unreachable"]),
  credentialUseState: z.enum(["inactive", "active", "transition_pending", "revocation_pending", "remediation_required", "revoked"]),
  lastValidatedAt: z.iso.datetime().nullable(),
  roles: z.array(settingsConnectionRoleSchema).max(3).readonly(),
}).strict().superRefine((connection, context) => {
  const roles = connection.roles.map((item) => item.role);
  if (new Set(roles).size !== roles.length) {
    context.addIssue({ code: "custom", path: ["roles"], message: "connection roles must be unique" });
  }
});

const rowCountSchema = z.number().int().nonnegative().max(0xffff_ffff);

/**
 * Stored rows that other Host reads reject, by the read they affect. Integrity triggers keep new
 * writes valid, but older rows stay until repaired, and each affected read fails closed on them; the
 * counts let settings say why instead of the read failing silently.
 */
const storageIntegritySchema = z.object({
  malformedExpiries: rowCountSchema,
  invalidRegistrarObservations: rowCountSchema,
  rejectedDnsRows: rowCountSchema,
  rejectedListings: rowCountSchema,
  malformedOutboxRows: rowCountSchema,
}).strict();

/** Host settings read: redacted Provider connections, their role availability and storage integrity. */
export const settingsReadSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal("settings"),
  readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  freshness: portfolioFreshnessSchema,
  connections: z.array(settingsConnectionSchema).max(64).readonly(),
  storageIntegrity: storageIntegritySchema,
}).strict();

export type SettingsRead = z.infer<typeof settingsReadSchema>;
export type SettingsConnection = z.infer<typeof settingsConnectionSchema>;
export type SettingsStorageIntegrity = z.infer<typeof storageIntegritySchema>;

export function parseSettingsRead(input: unknown): SettingsRead {
  return settingsReadSchema.parse(copyPlainData(input));
}

export interface SettingsReadPort {
  loadSettings(): Promise<SettingsRead>;
}

/** Closed mapping from Host credential facts to the settings badge; revocation always wins. */
export function settingsConnectionHealth(connection: SettingsConnection): ProviderConnectionHealth {
  if (connection.lifecycleStatus === "revoked" || connection.credentialUseState === "revoked") return "revoked";
  if (connection.credentialUseState === "revocation_pending" || connection.credentialUseState === "remediation_required") return "action_required";
  if (connection.lifecycleStatus === "invalid" || connection.validationStatus === "invalid") return "invalid";
  if (connection.validationStatus === "insufficient_scope") return "action_required";
  if (connection.credentialUseState === "inactive") return "unconfigured";
  if (connection.credentialUseState === "transition_pending") return "verifying";
  return connection.validationStatus === "valid" ? "healthy" : "retained_unverified";
}

/**
 * How the connection authenticates. Only Cloudflare's API token flow exists; the other platforms'
 * methods are recorded from their official documentation in their own ADR-0027 phase, so until then
 * the method is unknown rather than guessed.
 */
function providerMethod(kind: SettingsConnection["providerKind"]): "api" | null {
  return kind === "cloudflare" ? "api" : null;
}

/**
 * Projects the Host read into the settings connection groups. A connection appears once per
 * declared role. Its key is a presentation key scoped to this read, not a Provider identifier, and
 * no connection offers an action: connect, reauthorize and manage need Host capabilities that are
 * not composed yet. `summary` supplies the localized unavailable-capability line.
 */
export function projectConnectionSettings(
  read: SettingsRead,
  summary: (connection: SettingsConnection) => string,
): ConnectionSettingsViewModel {
  const groups = (["registrar", "dns", "marketplace"] as const).map((category) => ({
    category,
    connections: read.connections.flatMap((connection, index): ConnectionSettingsItemViewModel[] =>
      connection.roles.some((item) => item.role === category)
        ? [{
          view: "active",
          providerConnectionId: `${category}-${index}`,
          provider: launchPlatformNames[connection.providerKind],
          accountAlias: connection.connectionLabel,
          remoteAccountId: null,
          category,
          method: providerMethod(connection.providerKind),
          summary: summary(connection),
          credentialHealth: settingsConnectionHealth(connection),
          quotaSummary: null,
          lastCheckedAt: connection.lastValidatedAt,
          admission: { actionAvailability: "unavailable" },
        }]
        : []),
  }));
  return { schemaVersion: 1, surface: "active", groups };
}
