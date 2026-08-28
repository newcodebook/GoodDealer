import { identifier } from "@gooddealer/protocol/wire";

export const PUBLIC_SESSION_COOKIE = "gd_session" as const;

export interface PublicPrincipal {
  readonly accountId: string;
  readonly sessionId: string;
  readonly clientKind: "account_web" | "desktop";
}

export interface PublicSessionVerifierPort {
  readonly cookieName: typeof PUBLIC_SESSION_COOKIE;
  verify(sessionId: string | null, now: Date): Promise<PublicPrincipal | null>;
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
    return {
      accountId: session.accountId,
      sessionId: parsedSessionId.data,
      clientKind: session.clientKind,
    };
  }
}
