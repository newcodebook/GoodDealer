import { identifier } from "@gooddealer/protocol/wire";

export interface IdentitySessionVerificationSnapshot {
  readonly sessionId: string;
  readonly accountId: string;
  readonly clientKind: "account_web" | "desktop";
  readonly expiresAt: string | null;
  readonly sessionAccountSecurityEpoch: number;
  readonly currentAccountSecurityEpoch: number;
  readonly familyState: "active" | "revoked" | null;
}

export interface IdentitySessionVerificationReader {
  readSessionVerification(sessionId: string): unknown | Promise<unknown>;
}

/**
 * Applies identity-owned session policy to a fresh snapshot on every request.
 * The reader remains the only source of family revocation and epoch state.
 */
export class IdentityAccountSessionVerifier {
  readonly #sessions: IdentitySessionVerificationReader;

  constructor(sessions: IdentitySessionVerificationReader) {
    this.#sessions = sessions;
  }

  async verifySession(
    sessionId: string,
    now: Date,
  ): Promise<{ readonly accountId: string; readonly clientKind: IdentitySessionVerificationSnapshot["clientKind"] } | null> {
    const parsedSessionId = identifier.safeParse(sessionId);
    if (!parsedSessionId.success || !Number.isFinite(now.getTime())) return null;
    const session = parseSessionSnapshot(await this.#sessions.readSessionVerification(parsedSessionId.data));
    if (
      session === null
      || session.sessionId !== parsedSessionId.data
      || session.familyState !== "active"
      || session.sessionAccountSecurityEpoch !== session.currentAccountSecurityEpoch
    ) {
      return null;
    }
    if (session.clientKind === "account_web") {
      if (session.expiresAt === null || Date.parse(session.expiresAt) <= now.getTime()) return null;
    } else if (session.expiresAt !== null) {
      return null;
    }
    return { accountId: session.accountId, clientKind: session.clientKind };
  }
}

const SNAPSHOT_KEYS = [
  "sessionId",
  "accountId",
  "clientKind",
  "expiresAt",
  "sessionAccountSecurityEpoch",
  "currentAccountSecurityEpoch",
  "familyState",
] as const;

function parseSessionSnapshot(value: unknown): IdentitySessionVerificationSnapshot | null {
  if (!hasExactDataProperties(value, SNAPSHOT_KEYS)) return null;
  const sessionId = identifier.safeParse(value.sessionId);
  const accountId = identifier.safeParse(value.accountId);
  if (!sessionId.success || !accountId.success) return null;
  if (value.clientKind !== "account_web" && value.clientKind !== "desktop") return null;
  if (value.familyState !== "active" && value.familyState !== "revoked" && value.familyState !== null) return null;
  if (!isSecurityEpoch(value.sessionAccountSecurityEpoch) || !isSecurityEpoch(value.currentAccountSecurityEpoch)) return null;
  if (value.expiresAt !== null && !isCanonicalTimestamp(value.expiresAt)) return null;
  return {
    sessionId: sessionId.data,
    accountId: accountId.data,
    clientKind: value.clientKind,
    expiresAt: value.expiresAt,
    sessionAccountSecurityEpoch: value.sessionAccountSecurityEpoch,
    currentAccountSecurityEpoch: value.currentAccountSecurityEpoch,
    familyState: value.familyState,
  };
}

function hasExactDataProperties(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor;
  });
}

function isSecurityEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().replace(".000Z", "Z") === value;
}
