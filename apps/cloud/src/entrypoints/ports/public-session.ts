import { identifier } from "@gooddealer/protocol/wire";

const publicPrincipalBrand: unique symbol = Symbol("PublicPrincipal");

export const PUBLIC_SESSION_COOKIE = "gd_session" as const;

export interface PublicPrincipal {
  readonly [publicPrincipalBrand]: true;
  readonly accountId: string;
  readonly sessionId: string;
}

export interface PublicSessionVerifierPort {
  readonly cookieName: typeof PUBLIC_SESSION_COOKIE;
  verify(sessionId: string | null, now: Date): Promise<PublicPrincipal | null>;
}

export interface AccountSessionVerifierPort {
  /** Owned by Cloud identity; every non-live session has the same null identity. */
  verifyWebSession(sessionId: string, now: Date): Promise<{ accountId: string } | null>;
}

export class CloudPublicSessionVerifier implements PublicSessionVerifierPort {
  readonly cookieName = PUBLIC_SESSION_COOKIE;
  readonly #identity: AccountSessionVerifierPort;

  constructor(identity: AccountSessionVerifierPort) {
    this.#identity = identity;
  }

  async verify(sessionId: string | null, now: Date): Promise<PublicPrincipal | null> {
    if (sessionId === null) return null;
    const session = await this.#identity.verifyWebSession(sessionId, now);
    if (session === null) return null;
    return {
      [publicPrincipalBrand]: true,
      accountId: session.accountId,
      sessionId,
    };
  }
}

export interface StaticPublicSession {
  readonly sessionId: string;
  readonly accountId: string;
  readonly expiresAt?: Date;
  readonly revoked?: boolean;
}

export class StaticPublicSessionVerifier implements PublicSessionVerifierPort {
  readonly cookieName = PUBLIC_SESSION_COOKIE;
  readonly #sessions = new Map<string, StaticPublicSession>();

  constructor(sessions: readonly StaticPublicSession[]) {
    for (const session of sessions) {
      identifier.parse(session.sessionId);
      identifier.parse(session.accountId);
      this.#sessions.set(session.sessionId, { ...session });
    }
  }

  async verify(sessionId: string | null, now: Date): Promise<PublicPrincipal | null> {
    if (sessionId === null) {
      return null;
    }
    const session = this.#sessions.get(sessionId);
    if (session === undefined || session.revoked === true) {
      return null;
    }
    if (session.expiresAt !== undefined && session.expiresAt.getTime() <= now.getTime()) {
      return null;
    }
    return {
      [publicPrincipalBrand]: true,
      accountId: session.accountId,
      sessionId: session.sessionId,
    };
  }
}
