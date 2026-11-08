import type { CloudflareConnectionStatus } from "../../adapters/tauri";

/** What the settings and onboarding surfaces say about Cloudflare, decided only from the Host status. */
export type CloudflareNotice =
  | "unreadable"
  | "busy"
  | "recovering"
  | "blocked"
  | "revoked"
  | "unqualified"
  | "operationUnconfirmed"
  | "zoneUnimportable"
  | "providerUnreachable"
  | "providerRetryLater"
  | "credentialRejected"
  | "operationFailed"
  | "notConfigured"
  | "connected";

export interface CloudflareStatusPort {
  status(): Promise<CloudflareConnectionStatus>;
}

/**
 * Precedence, highest first:
 * - an unreadable status says nothing else, so no other claim is made;
 * - `busy` wins over `lastOperation`, which still names the previous operation while one runs;
 * - a confirmed revocation keeps asking the user to delete or roll the token at Cloudflare,
 *   because revoking only removes this device's custody, never the token itself;
 * - an unqualified capability (ADR-0024) outranks earlier operation outcomes, which can only
 *   have been attempted before qualification was withdrawn or never ran at all.
 */
export function cloudflareNotice(status: CloudflareConnectionStatus | null): CloudflareNotice {
  if (status === null) return "unreadable";
  if (status.state === "busy" || status.state === "recovering" || status.state === "blocked") return status.state;
  const last = status.lastOperation;
  if (last !== null && last.kind === "revoke" && last.outcome === "confirmed") return "revoked";
  if (!status.qualified) return "unqualified";
  if (last !== null && last.outcome === "unconfirmed") return "operationUnconfirmed";
  if (last !== null && last.outcome === "zone_unimportable") return "zoneUnimportable";
  // Each failed Provider call fails closed (nothing is written) and says how to recover.
  if (last !== null && last.outcome === "unreachable") return "providerUnreachable";
  if (last !== null && last.outcome === "retry_later") return "providerRetryLater";
  if (last !== null && last.outcome === "credential_rejected") return "credentialRejected";
  if (last !== null && last.outcome === "failed") return "operationFailed";
  return status.state === "ready" ? "connected" : "notConfigured";
}

/** Reads the Host status; any failure is an unreadable status, never a guessed one. */
export async function readCloudflareNotice(port: CloudflareStatusPort): Promise<{ readonly status: CloudflareConnectionStatus | null; readonly notice: CloudflareNotice }> {
  try {
    const status = await port.status();
    return { status, notice: cloudflareNotice(status) };
  } catch {
    return { status: null, notice: "unreadable" };
  }
}

/** The settings-surface copy key for each notice; onboarding shows the same sentence. */
export const cloudflareNoticeCopyKey = {
  unreadable: "cloudflareUnreadable",
  busy: "cloudflareBusy",
  recovering: "cloudflareRecovering",
  blocked: "cloudflareBlocked",
  revoked: "cloudflareRevoked",
  unqualified: "cloudflareUnqualified",
  operationUnconfirmed: "cloudflareOperationUnconfirmed",
  zoneUnimportable: "cloudflareZoneUnimportable",
  providerUnreachable: "cloudflareProviderUnreachable",
  providerRetryLater: "cloudflareProviderRetryLater",
  credentialRejected: "cloudflareCredentialRejected",
  operationFailed: "cloudflareOperationFailed",
  notConfigured: "cloudflareNotConfigured",
  connected: "cloudflareConnected",
} as const satisfies Record<CloudflareNotice, string>;
