import {
  ACCOUNT_REJECTION_SCHEMA_VERSION,
  AUTH_SESSION_SCHEMA_VERSION,
  accountRejectionSchema,
  type AccountRejection,
} from "@gooddealer/protocol/account";

import {
  DenyingPasswordHashPort,
  type PasswordHashPort,
  type StoredPasswordHash,
} from "./password-hash-port";

interface InternalLoginCommand {
  readonly schemaVersion: typeof AUTH_SESSION_SCHEMA_VERSION;
  readonly method: "password";
  readonly deviceId: string;
  readonly rememberDevice: boolean;
  readonly emailNormalized: string;
  /** D-022 credential value; it is consumed only by PasswordHashPort and never retained. */
  readonly secret: string;
}

export interface InternalPasswordAccountRecord {
  readonly emailNormalized: string;
  readonly storedPasswordHash: StoredPasswordHash;
  readonly emailVerified: boolean;
}

export interface InternalLoginCommandRejection {
  readonly code: "SCHEMA_INVALID";
}

const decoyPasswordHash: StoredPasswordHash = {
  algorithm: "argon2id",
  params: { memoryKiB: 65_536, iterations: 3, parallelism: 1 },
  salt: "AAAAAAAAAAAAAAAAAAAAAA",
  hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

/**
 * Module-internal real credential path. It deliberately cannot authenticate while the
 * denying password port is the only structurally permitted implementation.
 */
export class InternalPasswordLoginCommandService {
  readonly #accounts: ReadonlyMap<string, InternalPasswordAccountRecord>;
  readonly #passwordHash: PasswordHashPort;

  constructor(
    accounts: readonly InternalPasswordAccountRecord[],
    passwordHash: PasswordHashPort = new DenyingPasswordHashPort(),
  ) {
    this.#accounts = new Map(accounts.map((account) => [account.emailNormalized, account]));
    this.#passwordHash = passwordHash;
  }

  async execute(input: unknown): Promise<AccountRejection | InternalLoginCommandRejection> {
    const command = parseInternalLoginCommand(input);
    if (command === null) return { code: "SCHEMA_INVALID" };

    const account = this.#accounts.get(command.emailNormalized);
    await this.#passwordHash.checkPasswordHash(
      command.secret,
      account?.storedPasswordHash ?? decoyPasswordHash,
    );

    // The port result has no successful variant. A future widening must change both the
    // port type and this closed command outcome before authentication can succeed.
    return rejection("INVALID_CREDENTIALS");
  }
}

function parseInternalLoginCommand(input: unknown): InternalLoginCommand | null {
  if (!isRecord(input)) return null;
  const allowedKeys = new Set([
    "schemaVersion",
    "method",
    "deviceId",
    "rememberDevice",
    "emailNormalized",
    "secret",
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return null;
  if (
    input.schemaVersion !== AUTH_SESSION_SCHEMA_VERSION ||
    input.method !== "password" ||
    typeof input.deviceId !== "string" ||
    input.deviceId.length < 1 ||
    typeof input.rememberDevice !== "boolean" ||
    typeof input.emailNormalized !== "string" ||
    typeof input.secret !== "string" ||
    input.secret.length < 1 ||
    input.secret.length > 4_096
  ) {
    return null;
  }
  const emailNormalized = input.emailNormalized.normalize("NFKC").trim().toLowerCase();
  if (emailNormalized.length < 3 || emailNormalized.length > 320 || emailNormalized !== input.emailNormalized) {
    return null;
  }
  return {
    schemaVersion: input.schemaVersion,
    method: input.method,
    deviceId: input.deviceId,
    rememberDevice: input.rememberDevice,
    emailNormalized,
    secret: input.secret,
  };
}

function rejection(code: "INVALID_CREDENTIALS"): AccountRejection {
  return accountRejectionSchema.parse({
    schemaVersion: ACCOUNT_REJECTION_SCHEMA_VERSION,
    code,
    retryable: false,
    retryAfterSeconds: null,
    correlationId: "identity-login-rejected",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
