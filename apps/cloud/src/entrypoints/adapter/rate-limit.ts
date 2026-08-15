export interface RateLimitPolicy {
  readonly windowMs: number;
  readonly burst: number;
  readonly identityHeaderNames: readonly [];
}

export type RateLimitIdentity = `session:${string}` | `addr:${string}`;

export interface RateLimitIdentityResolver<TRequest> {
  resolve(request: TRequest): RateLimitIdentity;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number | null;
}

interface WindowState {
  count: number;
  resetAtMs: number;
}

export const NO_IDENTITY_HEADERS: readonly [] = [];

export function rateLimitPolicy(windowMs: number, burst: number): RateLimitPolicy {
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new Error("rate-limit window must be a positive safe integer");
  }
  if (!Number.isSafeInteger(burst) || burst <= 0) {
    throw new Error("rate-limit burst must be a positive safe integer");
  }
  return { windowMs, burst, identityHeaderNames: NO_IDENTITY_HEADERS };
}

export class InMemoryFixedWindowRateLimiter {
  readonly #policy: RateLimitPolicy;
  readonly #windows = new Map<RateLimitIdentity, WindowState>();

  constructor(policy: RateLimitPolicy) {
    this.#policy = rateLimitPolicy(policy.windowMs, policy.burst);
    if (policy.identityHeaderNames.length !== 0) {
      throw new Error("request headers cannot select a rate-limit bucket");
    }
  }

  consume(identity: RateLimitIdentity): RateLimitDecision {
    // Deliberately use the real wall clock so reset behavior remains externally observable.
    const nowMs = Date.now();
    const existing = this.#windows.get(identity);
    const window = existing === undefined || existing.resetAtMs <= nowMs
      ? { count: 0, resetAtMs: nowMs + this.#policy.windowMs }
      : existing;

    if (window.count >= this.#policy.burst) {
      this.#windows.set(identity, window);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((window.resetAtMs - nowMs) / 1_000)),
      };
    }

    window.count += 1;
    this.#windows.set(identity, window);
    return { allowed: true, retryAfterSeconds: null };
  }
}

export function preAuthRateLimitIdentity(clientAddress: string): RateLimitIdentity {
  return `addr:${clientAddress}`;
}

export function sessionRateLimitIdentity(verifiedSessionId: string): RateLimitIdentity {
  return `session:${verifiedSessionId}`;
}

export function adminRateLimitIdentity(clientAddress: string): RateLimitIdentity {
  return `addr:${clientAddress}`;
}

export function cookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (cookieHeader === undefined) {
    return null;
  }

  let value: string | null = null;
  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0 || segment.slice(0, separator).trim() !== name) {
      continue;
    }
    if (value !== null) {
      return null;
    }
    value = segment.slice(separator + 1).trim();
  }
  return value;
}
