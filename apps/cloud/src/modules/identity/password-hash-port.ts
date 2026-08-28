import { randomBytes } from "node:crypto";

import { hash, verify, type Algorithm, type Version } from "@node-rs/argon2";

export const ARGON2ID_V1_POLICY = {
  id: "argon2id-v1",
  version: 19,
  memoryKiB: 65_536,
  iterations: 3,
  parallelism: 1,
  saltBytes: 16,
  hashBytes: 32,
} as const;

export const ARGON2ID_V1_DECOY_PHC =
  "$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$LdbrWSBmniQtvDYoGYwBKJog3XPrHYmO2XVTnqQy6lM";

export interface StoredPasswordHash {
  readonly policyId: typeof ARGON2ID_V1_POLICY.id;
  readonly phc: string;
}

export type PasswordHashResult =
  | { readonly verified: true }
  | { readonly verified: false; readonly reason: "invalid_credentials" | "password_verification_disabled" };

export interface PasswordHashPort {
  checkPasswordHash(candidate: ConsumeOncePassword, storedPhc: string): Promise<PasswordHashResult>;
}

/**
 * Owns the only zeroable copy identity creates. The source JavaScript string has already
 * existed in the caller/parser heap and cannot be reliably overwritten by JavaScript.
 */
export class ConsumeOncePassword {
  #bytes: Uint8Array | null;
  #lastConsumedBytes: Uint8Array | null = null;

  private constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  static fromUnknown(value: unknown): ConsumeOncePassword | null {
    if (typeof value !== "string" || value.length === 0 || hasUnpairedSurrogate(value)) return null;
    const bytes = new TextEncoder().encode(value);
    return bytes.length <= 1_024 ? new ConsumeOncePassword(bytes) : null;
  }

  async consume<Result>(operation: (bytes: Uint8Array) => Promise<Result>): Promise<Result> {
    const bytes = this.#bytes;
    if (bytes === null) return Promise.reject();
    this.#bytes = null;
    this.#lastConsumedBytes = bytes;
    try {
      return await operation(bytes);
    } finally {
      bytes.fill(0);
    }
  }

  /** Test/evidence observation only; returns no live credential bytes. */
  consumedBytesAreZeroed(): boolean {
    return this.#lastConsumedBytes?.every((byte) => byte === 0) ?? false;
  }

  toJSON(): string {
    return "[REDACTED]";
  }
}

/** Explicit opt-in verifier. Production composition continues to construct DenyingPasswordHashPort. */
export class Argon2idPasswordHashVerifier implements PasswordHashPort {
  async checkPasswordHash(candidate: ConsumeOncePassword, storedPhc: string): Promise<PasswordHashResult> {
    const phc = isArgon2idV1Phc(storedPhc) ? storedPhc : ARGON2ID_V1_DECOY_PHC;
    try {
      const verified = await candidate.consume((bytes) => verify(phc, bytes, argon2Options()));
      return verified ? { verified: true } : { verified: false, reason: "invalid_credentials" };
    } catch {
      return { verified: false, reason: "invalid_credentials" };
    }
  }
}

/** Closed production default; it consumes and zeroes candidate bytes without granting authority. */
export class DenyingPasswordHashPort implements PasswordHashPort {
  async checkPasswordHash(candidate: ConsumeOncePassword, _storedPhc: string): Promise<PasswordHashResult> {
    await candidate.consume(async () => undefined);
    return { verified: false, reason: "password_verification_disabled" };
  }
}

export async function hashFixturePassword(value: unknown): Promise<StoredPasswordHash> {
  const candidate = ConsumeOncePassword.fromUnknown(value);
  if (candidate === null) return Promise.reject();
  const phc = await candidate.consume((bytes) => hash(bytes, { ...argon2Options(), salt: randomBytes(16) }));
  return { policyId: ARGON2ID_V1_POLICY.id, phc };
}

export function isArgon2idV1Phc(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 160) return false;
  const match = /^\$argon2id\$v=19\$m=65536,t=3,p=1\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/u.exec(value);
  if (match === null) return false;
  return decodeUnpadded(match[1] ?? "").length === 16 && decodeUnpadded(match[2] ?? "").length === 32;
}

function argon2Options() {
  return {
    algorithm: 2 as Algorithm,
    version: 1 as Version,
    memoryCost: ARGON2ID_V1_POLICY.memoryKiB,
    timeCost: ARGON2ID_V1_POLICY.iterations,
    parallelism: ARGON2ID_V1_POLICY.parallelism,
    outputLen: ARGON2ID_V1_POLICY.hashBytes,
  } as const;
}

function decodeUnpadded(value: string): Buffer {
  return Buffer.from(`${value}${"=".repeat((4 - value.length % 4) % 4)}`, "base64");
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
