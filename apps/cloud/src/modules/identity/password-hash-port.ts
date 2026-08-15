export interface Argon2Params {
  readonly memoryKiB: number;
  readonly iterations: number;
  readonly parallelism: number;
}

export interface StoredPasswordHash {
  readonly algorithm: "argon2id";
  readonly params: Argon2Params;
  readonly salt: string;
  readonly hash: string;
}

export interface PasswordHashPort {
  /** P0-19 Fallback: widening this return type requires an explicit Gate decision. */
  checkPasswordHash(
    candidate: string,
    stored: StoredPasswordHash,
  ): Promise<{
    readonly verified: false;
    readonly reason: "password_verification_disabled";
  }>;
}

/** Internal fixture accounts cannot authenticate with a real password. */
export class DenyingPasswordHashPort implements PasswordHashPort {
  async checkPasswordHash(
    _candidate: string,
    _stored: StoredPasswordHash,
  ): Promise<{
    readonly verified: false;
    readonly reason: "password_verification_disabled";
  }> {
    return { verified: false, reason: "password_verification_disabled" };
  }
}
