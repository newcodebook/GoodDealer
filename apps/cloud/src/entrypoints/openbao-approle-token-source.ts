export interface OpenBaoAppRoleCredentials {
  readonly roleId: string;
  readonly secretId: string;
}

export interface OpenBaoAppRoleTokenSourceConfiguration {
  readonly address: string;
  readonly authMount?: string;
  readonly requiredPolicy: string;
  readonly allowedPolicies: readonly string[];
  readonly credentialsSource: () => Promise<OpenBaoAppRoleCredentials>;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
  readonly requestTimeoutMs?: number;
  readonly renewalSkewSeconds?: number;
  readonly now?: () => number;
}

interface CachedToken {
  readonly value: string;
  readonly usableUntilMs: number;
}

export class OpenBaoAppRoleAuthenticationError extends Error {
  constructor() {
    super("OpenBao AppRole authentication failed");
    this.name = "OpenBaoAppRoleAuthenticationError";
  }
}

/**
 * Exchanges an AppRole SecretID for short-lived workload tokens and retains them only in memory.
 * Concurrent signing calls share one login so credential refresh cannot amplify OpenBao traffic.
 */
export class OpenBaoAppRoleTokenSource implements OpenBaoTransitTokenSource {
  readonly #origin: string;
  readonly #authMount: string;
  readonly #requiredPolicy: string;
  readonly #allowedPolicies: ReadonlySet<string>;
  readonly #credentialsSource: () => Promise<OpenBaoAppRoleCredentials>;
  readonly #fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly #requestTimeoutMs: number;
  readonly #renewalSkewSeconds: number;
  readonly #now: () => number;
  #cached: CachedToken | undefined;
  #pending: Promise<string> | undefined;

  constructor(configuration: OpenBaoAppRoleTokenSourceConfiguration) {
    this.#origin = parseOpenBaoOrigin(configuration.address);
    this.#authMount = parsePathSegment(configuration.authMount ?? "approle", "OpenBao auth mount");
    this.#requiredPolicy = parsePolicyName(configuration.requiredPolicy);
    this.#allowedPolicies = prepareAllowedPolicies(configuration.allowedPolicies, this.#requiredPolicy);
    this.#credentialsSource = configuration.credentialsSource;
    this.#fetch = configuration.fetch ?? fetch;
    this.#requestTimeoutMs = boundedInteger(configuration.requestTimeoutMs ?? 5_000, 100, 30_000);
    this.#renewalSkewSeconds = boundedInteger(configuration.renewalSkewSeconds ?? 60, 5, 300);
    this.#now = configuration.now ?? Date.now;
  }

  async token(): Promise<string> {
    const cached = this.#cached;
    if (cached !== undefined && this.#now() < cached.usableUntilMs) return cached.value;
    if (this.#pending !== undefined) return this.#pending;
    const pending = this.#login();
    this.#pending = pending;
    try {
      return await pending;
    } finally {
      if (this.#pending === pending) this.#pending = undefined;
    }
  }

  /** Invalidates only the credential observed by a rejected request, preserving a newer concurrent login. */
  invalidate(token: string): void {
    if (this.#cached?.value === token) this.#cached = undefined;
  }

  async #login(): Promise<string> {
    try {
      const credentials = await this.#credentialsSource();
      const roleId = parseCredential(credentials.roleId);
      const secretId = parseCredential(credentials.secretId);
      const response = await this.#fetch(
        `${this.#origin}/v1/auth/${encodeURIComponent(this.#authMount)}/login`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(this.#requestTimeoutMs),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role_id: roleId, secret_id: secretId }),
        },
      );
      if (!response.ok) {
        await cancelResponseBody(response);
        throw new OpenBaoAppRoleAuthenticationError();
      }
      const login = await readLoginResponse(response);
      if (!login.policies.includes(this.#requiredPolicy)
        || login.policies.some((policy) => !this.#allowedPolicies.has(policy))) {
        throw new OpenBaoAppRoleAuthenticationError();
      }
      const usableSeconds = login.leaseDurationSeconds - this.#renewalSkewSeconds;
      if (usableSeconds < 1) throw new OpenBaoAppRoleAuthenticationError();
      this.#cached = {
        value: login.token,
        usableUntilMs: this.#now() + usableSeconds * 1_000,
      };
      return login.token;
    } catch (error) {
      if (error instanceof OpenBaoAppRoleAuthenticationError) throw error;
      throw new OpenBaoAppRoleAuthenticationError();
    }
  }
}

async function readLoginResponse(response: Response): Promise<{
  readonly token: string;
  readonly leaseDurationSeconds: number;
  readonly policies: readonly string[];
}> {
  const maximumBytes = 32_768;
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    await cancelResponseBody(response);
    throw new OpenBaoAppRoleAuthenticationError();
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
    await cancelResponseBody(response);
    throw new OpenBaoAppRoleAuthenticationError();
  }
  if (response.body === null) throw new OpenBaoAppRoleAuthenticationError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new OpenBaoAppRoleAuthenticationError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total),
    ));
  } catch {
    throw new OpenBaoAppRoleAuthenticationError();
  }
  const root = plainRecord(decoded);
  const auth = plainRecord(root.auth);
  const token = parseCredential(auth.client_token);
  const leaseDurationSeconds = auth.lease_duration;
  if (!Number.isSafeInteger(leaseDurationSeconds) || Number(leaseDurationSeconds) < 1
    || Number(leaseDurationSeconds) > 3_600) {
    throw new OpenBaoAppRoleAuthenticationError();
  }
  if (!Array.isArray(auth.policies) || auth.policies.length < 1 || auth.policies.length > 32
    || auth.policies.some((policy) => typeof policy !== "string" || parsePolicyName(policy) !== policy)) {
    throw new OpenBaoAppRoleAuthenticationError();
  }
  return { token, leaseDurationSeconds: Number(leaseDurationSeconds), policies: auth.policies as string[] };
}

function parseOpenBaoOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("OpenBao address is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== ""
    || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new TypeError("OpenBao address must be an HTTPS origin");
  }
  return parsed.origin;
}

function parsePathSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function parsePolicyName(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new OpenBaoAppRoleAuthenticationError();
  }
  return value;
}

function prepareAllowedPolicies(values: readonly string[], requiredPolicy: string): ReadonlySet<string> {
  if (!Array.isArray(values) || values.length < 1 || values.length > 32) {
    throw new TypeError("OpenBao AppRole allowed policies are invalid");
  }
  const allowed = new Set(values.map(parsePolicyName));
  if (allowed.size !== values.length || !allowed.has(requiredPolicy)) {
    throw new TypeError("OpenBao AppRole allowed policies are invalid");
  }
  return allowed;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Authentication failures stay generic even when a broken transport also refuses cancellation.
  }
}

function parseCredential(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 8_192
    || /[\u0000-\u0020\u007f]/u.test(value)) {
    throw new OpenBaoAppRoleAuthenticationError();
  }
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError("OpenBao AppRole timing configuration is invalid");
  }
  return value;
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new OpenBaoAppRoleAuthenticationError();
  }
  return value as Record<string, unknown>;
}
import type { OpenBaoTransitTokenSource } from "./openbao-transit-signer";
