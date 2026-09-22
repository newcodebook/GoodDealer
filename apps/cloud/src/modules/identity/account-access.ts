import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";

import {
  ARGON2ID_V1_DECOY_PHC,
  ConsumeOncePassword,
  isArgon2idV1Phc,
  type PasswordCreationPort,
  type PasswordHashPort,
  type StoredPasswordHash,
} from "./password-hash-port";
import type { EmailDeliveryPort, IdentityEmailMessage } from "./email-delivery";

export interface IdentityAccountAccessRecord {
  readonly accountId: string;
  readonly emailNormalized: string;
  readonly emailVerified: boolean;
  readonly storedPasswordHash: StoredPasswordHash;
  readonly accountSecurityEpoch: number;
}

export interface RegistrationWrite {
  readonly purpose: "registration";
  readonly accountId: string;
  readonly workspaceId: string;
  readonly emailNormalized: string;
  readonly password: StoredPasswordHash;
  readonly challengeDigest: Uint8Array;
  readonly challengeExpiresAt: Date;
  readonly resendAvailableAt: Date;
  readonly outboxId: string;
  readonly envelope: SealedEmailEnvelope;
}

export interface VerificationDeliveryWrite {
  readonly purpose: "registration" | "password_reset";
  readonly emailNormalized: string;
  readonly challengeDigest: Uint8Array;
  readonly challengeExpiresAt: Date;
  readonly resendAvailableAt: Date;
  readonly outboxId: string;
  readonly envelope: SealedEmailEnvelope;
}

export interface PresentedAccountWebSession {
  readonly accountId: string;
  readonly sessionId: string;
}

export interface IdentityAccountAccessRepository {
  findExactAccount(emailNormalized: string): Promise<IdentityAccountAccessRecord | null>;
  requestRegistration(write: RegistrationWrite, now: Date): Promise<"queued" | "cooldown" | "already_verified">;
  resendRegistration(write: VerificationDeliveryWrite, now: Date): Promise<"queued" | "cooldown" | "unavailable">;
  verifyRegistration(input: {
    readonly emailNormalized: string;
    readonly challengeDigest: Uint8Array;
    readonly now: Date;
  }): Promise<{ readonly status: "verified"; readonly account: IdentityAccountAccessRecord }
    | { readonly status: "invalid" }>;
  requestPasswordReset(write: VerificationDeliveryWrite, now: Date): Promise<"queued" | "cooldown" | "unavailable">;
  resetPassword(input: {
    readonly emailNormalized: string;
    readonly challengeDigest: Uint8Array;
    readonly password: StoredPasswordHash;
    readonly now: Date;
  }): Promise<"completed" | "invalid">;
  issueAccountWebSession(input: {
    readonly accountId: string;
    readonly expectedEpoch: number;
    readonly sessionId: string;
    readonly familyId: string;
    readonly accessJti: string;
    readonly refreshJti: string;
    readonly expiresAt: Date;
  }): Promise<"issued" | "conflict">;
  revokeAccountWebSession(input: PresentedAccountWebSession & { readonly now: Date }): Promise<void>;
  claimEmail(now: Date): Promise<{
    readonly outboxId: string;
    readonly accountId: string;
    readonly envelope: SealedEmailEnvelope;
  } | null>;
  completeEmail(accountId: string, outboxId: string, delivered: boolean, now: Date):
    Promise<"sent" | "retry_scheduled" | "failed">;
}

export interface IdentityEmailDeliveryObserver {
  observe(event: { readonly outcome: "sent" | "retry_scheduled" | "failed" }): void | Promise<void>;
}

export interface SealedEmailEnvelope {
  readonly keyId: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly authenticationTag: Uint8Array;
}

export interface AccountAccessConfiguration {
  readonly verificationPepper: Uint8Array;
  readonly outboxKey: Uint8Array;
  readonly outboxKeyId: string;
  readonly now?: () => Date;
  readonly ids?: () => string;
  readonly codes?: () => string;
  readonly accountOrigin: string;
}

export type AccountAccessResult =
  | { readonly status: "accepted" }
  | { readonly status: "invalid" }
  | { readonly status: "verified" }
  | { readonly status: "completed" }
  | { readonly status: "signed_out" }
  | { readonly status: "authenticated"; readonly sessionCredential: string; readonly expiresAt: Date };

export class IdentityAccountAccessService {
  readonly #repository: IdentityAccountAccessRepository;
  readonly #passwords: PasswordHashPort & PasswordCreationPort;
  readonly #pepper: Uint8Array;
  readonly #outboxKey: Uint8Array;
  readonly #outboxKeyId: string;
  readonly #now: () => Date;
  readonly #ids: () => string;
  readonly #codes: () => string;
  readonly #accountOrigin: string;

  constructor(repository: IdentityAccountAccessRepository, passwords: PasswordHashPort & PasswordCreationPort,
    configuration: AccountAccessConfiguration) {
    if (configuration.verificationPepper.byteLength !== 32 || configuration.outboxKey.byteLength !== 32
      || !/^[A-Za-z0-9._-]{1,80}$/u.test(configuration.outboxKeyId)) {
      throw new TypeError("Identity account access key configuration is invalid");
    }
    this.#repository = repository;
    this.#passwords = passwords;
    this.#pepper = Uint8Array.from(configuration.verificationPepper);
    this.#outboxKey = Uint8Array.from(configuration.outboxKey);
    this.#outboxKeyId = configuration.outboxKeyId;
    this.#now = configuration.now ?? (() => new Date());
    this.#ids = configuration.ids ?? randomUUID;
    this.#codes = configuration.codes ?? (() => randomInt(0, 1_000_000).toString().padStart(6, "0"));
    this.#accountOrigin = parseAccountOrigin(configuration.accountOrigin);
  }

  async requestRegistration(emailValue: unknown, passwordValue: unknown): Promise<AccountAccessResult> {
    const emailNormalized = normalizeEmail(emailValue);
    const password = ConsumeOncePassword.fromUnknown(passwordValue);
    if (emailNormalized === null || password === null || !passwordPolicy(passwordValue)) return { status: "invalid" };
    const stored = await this.#passwords.hashPassword(password);
    const now = this.#now();
    const delivery = this.#verificationDelivery(emailNormalized, "registration", now);
    await this.#repository.requestRegistration({
      accountId: `acct_${this.#ids()}`,
      workspaceId: `ws_${this.#ids()}`,
      password: stored,
      ...delivery,
    }, now);
    return { status: "accepted" };
  }

  async resendRegistration(emailValue: unknown): Promise<AccountAccessResult> {
    const emailNormalized = normalizeEmail(emailValue);
    if (emailNormalized === null) return { status: "invalid" };
    const now = this.#now();
    await this.#repository.resendRegistration(
      this.#verificationDelivery(emailNormalized, "registration", now), now,
    );
    return { status: "accepted" };
  }

  async verifyRegistration(emailValue: unknown, codeValue: unknown): Promise<AccountAccessResult> {
    const emailNormalized = normalizeEmail(emailValue);
    if (emailNormalized === null || typeof codeValue !== "string" || !/^\d{6}$/u.test(codeValue)) {
      return { status: "invalid" };
    }
    const now = this.#now();
    const verified = await this.#repository.verifyRegistration({
      emailNormalized,
      challengeDigest: challengeDigest(this.#pepper, "registration", emailNormalized, codeValue),
      now,
    });
    if (verified.status !== "verified") return { status: "invalid" };
    return { status: "verified" };
  }

  async login(emailValue: unknown, passwordValue: unknown,
    presentedSession?: PresentedAccountWebSession): Promise<AccountAccessResult> {
    const emailNormalized = normalizeEmail(emailValue);
    const candidate = ConsumeOncePassword.fromUnknown(passwordValue);
    if (emailNormalized === null || candidate === null) return { status: "invalid" };
    const account = await this.#repository.findExactAccount(emailNormalized);
    const phc = account?.storedPasswordHash.policyId === "argon2id-v1"
      && isArgon2idV1Phc(account.storedPasswordHash.phc)
      ? account.storedPasswordHash.phc : ARGON2ID_V1_DECOY_PHC;
    const checked = await this.#passwords.checkPasswordHash(candidate, phc);
    if (!checked.verified || account === null || !account.emailVerified) return { status: "invalid" };
    if (presentedSession !== undefined) {
      await this.#repository.revokeAccountWebSession({ ...presentedSession, now: this.#now() });
    }
    return this.#issueSession(account, this.#now());
  }

  async requestPasswordReset(emailValue: unknown): Promise<AccountAccessResult> {
    const emailNormalized = normalizeEmail(emailValue);
    if (emailNormalized === null) return { status: "invalid" };
    const now = this.#now();
    await this.#repository.requestPasswordReset(
      this.#verificationDelivery(emailNormalized, "password_reset", now), now,
    );
    return { status: "accepted" };
  }

  async resetPassword(emailValue: unknown, codeValue: unknown, passwordValue: unknown): Promise<AccountAccessResult> {
    const emailNormalized = normalizeEmail(emailValue);
    const password = ConsumeOncePassword.fromUnknown(passwordValue);
    if (emailNormalized === null || typeof codeValue !== "string" || !/^\d{6}$/u.test(codeValue)
      || password === null || !passwordPolicy(passwordValue)) return { status: "invalid" };
    const now = this.#now();
    const stored = await this.#passwords.hashPassword(password);
    const result = await this.#repository.resetPassword({
      emailNormalized,
      challengeDigest: challengeDigest(this.#pepper, "password_reset", emailNormalized, codeValue),
      password: stored,
      now,
    });
    return result === "completed" ? { status: "completed" } : { status: "invalid" };
  }

  async logout(presentedSession: PresentedAccountWebSession): Promise<AccountAccessResult> {
    await this.#repository.revokeAccountWebSession({ ...presentedSession, now: this.#now() });
    return { status: "signed_out" };
  }

  async #issueSession(account: IdentityAccountAccessRecord, now: Date): Promise<AccountAccessResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const sessionCredential = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
      const issued = await this.#repository.issueAccountWebSession({
        accountId: account.accountId,
        expectedEpoch: account.accountSecurityEpoch,
        sessionId: sessionCredential,
        familyId: this.#ids(),
        accessJti: this.#ids(),
        refreshJti: this.#ids(),
        expiresAt,
      });
      if (issued === "issued") return { status: "authenticated", sessionCredential, expiresAt };
    }
    throw new Error("account web session allocation failed");
  }

  #verificationDelivery<Purpose extends "registration" | "password_reset">(
    emailNormalized: string,
    purpose: Purpose,
    now: Date,
  ): VerificationDeliveryWrite & { readonly purpose: Purpose } {
    const code = this.#codes();
    if (!/^\d{6}$/u.test(code)) throw new Error("verification code generator failed");
    const registration = purpose === "registration";
    const message: IdentityEmailMessage = {
      to: emailNormalized,
      subject: registration ? "GoodDealer 邮箱验证码" : "GoodDealer 密码重置验证码",
      text: registration
        ? `你的 GoodDealer 验证码是：${code}\n\n打开 ${this.#accountOrigin} 完成验证。验证码 15 分钟内有效且只能使用一次；如多次请求，请使用最新验证码。若非本人操作，请忽略此邮件。`
        : `你的 GoodDealer 密码重置验证码是：${code}\n\n打开 ${this.#accountOrigin} 完成密码重置。验证码 15 分钟内有效且只能使用一次；如多次请求，请使用最新验证码。若非本人操作，请忽略此邮件。`,
    };
    return {
      purpose,
      emailNormalized,
      challengeDigest: challengeDigest(this.#pepper, purpose, emailNormalized, code),
      challengeExpiresAt: new Date(now.getTime() + 15 * 60_000),
      resendAvailableAt: new Date(now.getTime() + 60_000),
      outboxId: this.#ids(),
      envelope: sealEmail(this.#outboxKey, this.#outboxKeyId, message),
    };
  }
}

export class IdentityEmailOutboxWorker {
  constructor(private readonly repository: IdentityAccountAccessRepository,
    private readonly delivery: EmailDeliveryPort, private readonly key: Uint8Array,
    private readonly keyId: string, private readonly now: () => Date = () => new Date(),
    private readonly observer?: IdentityEmailDeliveryObserver) {}

  async runOnce(): Promise<boolean> {
    const item = await this.repository.claimEmail(this.now());
    if (item === null) return false;
    try {
      await this.delivery.deliver({
        idempotencyKey: item.outboxId,
        message: openEmail(this.key, this.keyId, item.envelope),
      });
      const outcome = await this.repository.completeEmail(item.accountId, item.outboxId, true, this.now());
      await this.#observe(outcome);
    } catch (error) {
      const outcome = await this.repository.completeEmail(item.accountId, item.outboxId, false, this.now());
      await this.#observe(outcome);
      throw error;
    }
    return true;
  }

  async #observe(outcome: "sent" | "retry_scheduled" | "failed"): Promise<void> {
    try {
      await this.observer?.observe({ outcome });
    } catch {
      // Delivery state is already durable; telemetry cannot change or replay it.
    }
  }
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (new TextEncoder().encode(normalized).length > 320
    || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(normalized)) return null;
  return normalized;
}

function passwordPolicy(value: unknown): boolean {
  return typeof value === "string" && value.length >= 12 && new TextEncoder().encode(value).length <= 1_024;
}

function challengeDigest(
  pepper: Uint8Array,
  purpose: "registration" | "password_reset",
  email: string,
  code: string,
): Uint8Array {
  return createHmac("sha256", pepper).update("GOODDEALER-IDENTITY-CHALLENGE-V2\0")
    .update(purpose).update("\0").update(email).update("\0").update(code).digest();
}

function parseAccountOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || url.username !== "" || url.password !== "") {
    throw new TypeError("Identity account origin must be an exact HTTPS origin");
  }
  return value;
}

function sealEmail(key: Uint8Array, keyId: string, message: IdentityEmailMessage): SealedEmailEnvelope {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`GOODDEALER-IDENTITY-EMAIL-V1\0${keyId}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(message), "utf8"), cipher.final()]);
  return { keyId, nonce, ciphertext, authenticationTag: cipher.getAuthTag() };
}

function openEmail(key: Uint8Array, keyId: string, envelope: SealedEmailEnvelope): IdentityEmailMessage {
  if (envelope.keyId !== keyId || envelope.nonce.byteLength !== 12 || envelope.authenticationTag.byteLength !== 16
    || envelope.ciphertext.byteLength < 1 || envelope.ciphertext.byteLength > 20_000) {
    throw new Error("identity email envelope is invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, envelope.nonce);
  decipher.setAAD(Buffer.from(`GOODDEALER-IDENTITY-EMAIL-V1\0${keyId}`, "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.authenticationTag));
  const value = JSON.parse(Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]).toString("utf8")) as unknown;
  if (!plainRecord(value) || typeof value.to !== "string" || typeof value.subject !== "string" || typeof value.text !== "string") {
    throw new Error("identity email payload is invalid");
  }
  return { to: value.to, subject: value.subject, text: value.text };
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === 3;
}
