import { identifier } from "@gooddealer/protocol/wire";

export const PUBLIC_SESSION_COOKIE = "gd_session" as const;

export interface PublicPrincipal {
  readonly accountId: string;
  readonly sessionId: string;
  readonly clientKind: "account_web" | "desktop";
  /** Server-internal only; deliberately non-enumerable so route serialization cannot expose it. */
  readonly transactionCredential?: Uint8Array;
}

export interface PublicSessionVerifierPort {
  readonly cookieName: typeof PUBLIC_SESSION_COOKIE;
  verify(sessionId: string | null, now: Date): Promise<PublicPrincipal | null>;
}

export interface DesktopAccessTokenVerifierPort {
  verifyAccessToken(token: string, now: Date): Promise<PublicPrincipal | null>;
}

export class DenyingDesktopAccessTokenVerifier implements DesktopAccessTokenVerifierPort {
  async verifyAccessToken(): Promise<null> {
    return null;
  }
}

export function bearerToken(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || value.length > 4_096) return null;
  const match = /^Bearer ([A-Za-z0-9._-]+)$/u.exec(value);
  return match?.[1] ?? null;
}

export interface AccountSessionVerifierPort {
  /** Owned by Cloud identity; every non-live session has the same null identity. */
  verifySession(
    sessionId: string,
    now: Date,
  ): Promise<{ readonly accountId: string; readonly clientKind: PublicPrincipal["clientKind"] } | null>;
}

export class CloudPublicSessionVerifier implements PublicSessionVerifierPort {
  readonly cookieName = PUBLIC_SESSION_COOKIE;
  readonly #identity: AccountSessionVerifierPort;

  constructor(identity: AccountSessionVerifierPort) {
    this.#identity = identity;
  }

  async verify(sessionId: string | null, now: Date): Promise<PublicPrincipal | null> {
    if (sessionId === null) return null;
    const parsedSessionId = identifier.safeParse(sessionId);
    if (!parsedSessionId.success || !Number.isFinite(now.getTime())) return null;
    const session = await this.#identity.verifySession(parsedSessionId.data, now);
    if (session === null) return null;
    return withTransactionCredential({
      accountId: session.accountId,
      sessionId: parsedSessionId.data,
      clientKind: session.clientKind,
    }, new TextEncoder().encode(parsedSessionId.data));
  }
}

export function withTransactionCredential(
  principal: Omit<PublicPrincipal, "transactionCredential">,
  credential: Uint8Array,
): PublicPrincipal {
  if (!(credential instanceof Uint8Array) || credential.byteLength < 1 || credential.byteLength > 4_096) {
    throw new TypeError("transaction credential is invalid");
  }
  const result: PublicPrincipal = { ...principal };
  Object.defineProperty(result, "transactionCredential", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Uint8Array.from(credential),
  });
  return result;
}
