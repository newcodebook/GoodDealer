import {
  ACCOUNT_REJECTION_SCHEMA_VERSION,
  AUTH_SESSION_SCHEMA_VERSION,
  accountRejectionSchema,
  type AccountRejection,
} from "@gooddealer/protocol/account";

import {
  ARGON2ID_V1_DECOY_PHC,
  ConsumeOncePassword,
  DenyingPasswordHashPort,
  isArgon2idV1Phc,
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
  readonly secret: ConsumeOncePassword;
}

export interface InternalPasswordAccountRecord {
  readonly emailNormalized: string;
  readonly storedPasswordHash: StoredPasswordHash;
  readonly emailVerified: boolean;
}

export interface InternalLoginCommandRejection {
  readonly code: "SCHEMA_INVALID";
}

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
    const stored = account?.storedPasswordHash;
    const phc = stored?.policyId === "argon2id-v1" && isArgon2idV1Phc(stored.phc)
      ? stored.phc
      : ARGON2ID_V1_DECOY_PHC;
    await this.#passwordHash.checkPasswordHash(command.secret, phc);

    // The port result has no successful variant. A future widening must change both the
    // port type and this closed command outcome before authentication can succeed.
    return rejection("INVALID_CREDENTIALS");
  }
}

function parseInternalLoginCommand(input: unknown): InternalLoginCommand | null {
  if (!isRecord(input)) return null;
  const fields = exactOwnDataProperties(input, [
    "schemaVersion",
    "method",
    "deviceId",
    "rememberDevice",
    "emailNormalized",
    "secret",
  ]);
  if (fields === null) return null;
  if (
    fields.schemaVersion !== AUTH_SESSION_SCHEMA_VERSION ||
    fields.method !== "password" ||
    typeof fields.deviceId !== "string" ||
    fields.deviceId.length < 1 ||
    typeof fields.rememberDevice !== "boolean" ||
    typeof fields.emailNormalized !== "string" ||
    typeof fields.secret !== "string"
  ) {
    return null;
  }
  const emailNormalized = fields.emailNormalized.normalize("NFKC").trim().toLowerCase();
  if (emailNormalized.length < 3 || emailNormalized.length > 320 || emailNormalized !== fields.emailNormalized) {
    return null;
  }
  const secret = ConsumeOncePassword.fromUnknown(fields.secret);
  if (secret === null) return null;
  return {
    schemaVersion: fields.schemaVersion,
    method: fields.method,
    deviceId: fields.deviceId,
    rememberDevice: fields.rememberDevice,
    emailNormalized,
    secret,
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

function exactOwnDataProperties(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): Record<string, unknown> | null {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expectedKeys.length || ownKeys.some((key) => typeof key !== "string")) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return null;
    result[key] = descriptor.value;
  }
  return result;
}
