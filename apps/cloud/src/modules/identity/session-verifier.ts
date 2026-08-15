import type { IdentitySessionVerificationSnapshot } from "./index";

export interface IdentitySessionVerificationReader {
  readSessionVerification(sessionId: string): IdentitySessionVerificationSnapshot | null;
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

  async verifyWebSession(sessionId: string, now: Date): Promise<{ accountId: string } | null> {
    const session = this.#sessions.readSessionVerification(sessionId);
    const expiresAt = session === null || session.expiresAt === null
      ? Number.NaN
      : Date.parse(session.expiresAt);
    if (
      session === null
      || session.clientKind !== "account_web"
      || session.familyState !== "active"
      || session.sessionAccountSecurityEpoch !== session.currentAccountSecurityEpoch
      || !Number.isFinite(expiresAt)
      || expiresAt <= now.getTime()
    ) {
      return null;
    }
    return { accountId: session.accountId };
  }
}
