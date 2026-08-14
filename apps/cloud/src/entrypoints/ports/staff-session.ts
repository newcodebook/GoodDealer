import { identifier } from "@gooddealer/protocol/wire";

const staffPrincipalBrand: unique symbol = Symbol("StaffPrincipal");

export const STAFF_SESSION_COOKIE = "gd_staff_session" as const;

export interface StaffPrincipal {
  readonly [staffPrincipalBrand]: true;
  readonly staffId: string;
  readonly sessionId: string;
  readonly scopes: ReadonlySet<string>;
}

export interface StaffSessionVerifierPort {
  readonly cookieName: typeof STAFF_SESSION_COOKIE;
  verify(sessionId: string | null, now: Date): Promise<StaffPrincipal | null>;
}

export interface StaticStaffSession {
  readonly sessionId: string;
  readonly staffId: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: Date;
  readonly revoked?: boolean;
}

export class StaticStaffSessionVerifier implements StaffSessionVerifierPort {
  readonly cookieName = STAFF_SESSION_COOKIE;
  readonly #sessions = new Map<string, StaticStaffSession>();

  constructor(sessions: readonly StaticStaffSession[]) {
    for (const session of sessions) {
      identifier.parse(session.sessionId);
      identifier.parse(session.staffId);
      this.#sessions.set(session.sessionId, { ...session, scopes: [...session.scopes] });
    }
  }

  async verify(sessionId: string | null, now: Date): Promise<StaffPrincipal | null> {
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
      [staffPrincipalBrand]: true,
      staffId: session.staffId,
      sessionId: session.sessionId,
      scopes: new Set(session.scopes),
    };
  }
}
