import type { CloudflareConnectionStatus, CloudflarePort } from "../../adapters/tauri";

/** What the settings and onboarding surfaces say about Cloudflare, decided only from the Host status. */
export type CloudflareNotice =
  | "unreadable"
  | "busy"
  | "recovering"
  | "blocked"
  | "revoked"
  | "unqualified"
  | "captureUnsupported"
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

/** The Cloudflare calls a production surface may make: the status, and connecting or revoking. */
export type CloudflareConnectionPort = CloudflareStatusPort & Pick<CloudflarePort, "create" | "activate" | "revoke" | "retirementCandidates" | "purge">;

/**
 * Precedence, highest first:
 * - an unreadable status says nothing else, so no other claim is made;
 * - `busy` wins over `lastOperation`, which still names the previous operation while one runs;
 * - a confirmed revocation keeps asking the user to delete or roll the token at Cloudflare,
 *   because revoking only removes this device's custody, never the token itself;
 * - an unqualified capability (ADR-0024) outranks earlier operation outcomes, which can only
 *   have been attempted before qualification was withdrawn or never ran at all;
 * - a Host that cannot capture a token (any platform but macOS) can never have connected, so it
 *   says that instead of any outcome.
 */
export function cloudflareNotice(status: CloudflareConnectionStatus | null): CloudflareNotice {
  if (status === null) return "unreadable";
  if (status.state === "busy" || status.state === "recovering" || status.state === "blocked") return status.state;
  const last = status.lastOperation;
  if (last !== null && last.kind === "revoke" && last.outcome === "confirmed") return "revoked";
  if (!status.qualified) return "unqualified";
  if (!status.capturable) return "captureUnsupported";
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

/**
 * Reads the Host status until the queued operation it reports is no longer running. Connecting
 * waits on the person typing a token into the native capture, so the wait is long but bounded;
 * `current` stops it as soon as the caller no longer wants the answer (unmount, a newer request).
 * Whatever the last read was is returned, so a still-running operation reads as `busy`.
 */
export async function settleCloudflareNotice(
  port: CloudflareStatusPort,
  current: () => boolean,
  wait: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 500)),
  attempts = 1_200,
): Promise<{ readonly status: CloudflareConnectionStatus | null; readonly notice: CloudflareNotice }> {
  let read = await readCloudflareNotice(port);
  for (let attempt = 1; attempt < attempts && current() && (read.notice === "busy" || read.notice === "recovering"); attempt += 1) {
    await wait();
    read = await readCloudflareNotice(port);
  }
  return read;
}

/** The settings-surface copy key for each notice; onboarding shows the same sentence. */
export const cloudflareNoticeCopyKey = {
  unreadable: "cloudflareUnreadable",
  busy: "cloudflareBusy",
  recovering: "cloudflareRecovering",
  blocked: "cloudflareBlocked",
  revoked: "cloudflareRevoked",
  unqualified: "cloudflareUnqualified",
  captureUnsupported: "cloudflareCaptureUnsupported",
  operationUnconfirmed: "cloudflareOperationUnconfirmed",
  zoneUnimportable: "cloudflareZoneUnimportable",
  providerUnreachable: "cloudflareProviderUnreachable",
  providerRetryLater: "cloudflareProviderRetryLater",
  credentialRejected: "cloudflareCredentialRejected",
  operationFailed: "cloudflareOperationFailed",
  notConfigured: "cloudflareNotConfigured",
  connected: "cloudflareConnected",
} as const satisfies Record<CloudflareNotice, string>;
