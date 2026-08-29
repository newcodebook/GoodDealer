import { identifier } from "@gooddealer/protocol/wire";

import type { PublicApplicationPorts } from "../../src/entrypoints/http";
import {
  PUBLIC_SESSION_COOKIE,
  type PublicPrincipal,
  type PublicSessionVerifierPort,
} from "../../src/entrypoints/ports/public-session";

export const denyingPublicApplicationPorts: PublicApplicationPorts = {
  accountActivation: {
    async activate() {
      return null;
    },
  },
};

export interface StaticPublicSession {
  readonly sessionId: string;
  readonly accountId: string;
  readonly clientKind?: PublicPrincipal["clientKind"];
  readonly expiresAt?: Date;
  readonly revoked?: boolean;
}

/** Test-only verifier for transport tests that do not exercise identity policy. */
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
    if (sessionId === null) return null;
    const session = this.#sessions.get(sessionId);
    if (
      session === undefined
      || session.revoked === true
      || (session.expiresAt !== undefined && session.expiresAt.getTime() <= now.getTime())
    ) return null;
    return {
      accountId: session.accountId,
      sessionId: session.sessionId,
      clientKind: session.clientKind ?? "account_web",
    };
  }
}
