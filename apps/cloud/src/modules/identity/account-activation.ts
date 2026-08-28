import { createHash } from "node:crypto";

import { identifier } from "@gooddealer/protocol/wire";

export interface AuthenticatedSubject {
  readonly stableSubject: string;
  readonly emailNormalized: string;
  readonly emailVerifiedAt: string;
  readonly passwordHashPhc: string;
  readonly clientKind: "account_web";
  readonly expiresAt: string;
  readonly revoked: false;
  readonly securityEpoch: number;
}

export interface ActivationResult {
  readonly state: "active";
  readonly accountId: string;
  readonly workspaceId: string;
}

export interface ActivationDatabaseClient {
  query<Row = unknown>(
    text: string, values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[]; readonly rowCount?: number | null }>;
  release?(error?: Error): void;
}

export interface ActivationDatabase {
  connect(): Promise<ActivationDatabaseClient>;
}

/** The only authority source for activation. Implementations must re-read and revalidate state. */
export interface AuthenticatedSubjectRevalidationPort {
  revalidate(): Promise<unknown>;
}

export class AccountActivationError extends Error {}

export async function activateAccount(
  database: ActivationDatabase,
  subjectPort: AuthenticatedSubjectRevalidationPort,
  intentValue: unknown,
  fault?: (point: "account" | "workspace" | "binding" | "initial-record") => void,
): Promise<ActivationResult> {
  parseActivationIntent(intentValue);
  const subject = parseAuthenticatedSubject(await subjectPort.revalidate());
  const ids = derivedIds(subject.stableSubject);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await database.connect();
    let open = false;
    try {
      await client.query("BEGIN");
      open = true;
      await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [subject.stableSubject]);
      await client.query("SELECT set_config('gooddealer.account_id', $1, true)", [ids.accountId]);
      await client.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [ids.workspaceId]);

      const account = await client.query(
        "SELECT account_id, email_normalized FROM identity_accounts WHERE email_normalized = $1",
        [subject.emailNormalized],
      );
      const existing = parseOptionalRow(readSingleRow(account), ["account_id", "email_normalized"], (row) =>
        typeof row.account_id === "string" && typeof row.email_normalized === "string");
      if (existing !== undefined && existing.account_id !== ids.accountId) throw new AccountActivationError("activation identity conflict");
      if (existing === undefined) {
        await client.query(
          `INSERT INTO identity_accounts
             (account_id, email_normalized, email_verified_at, password_policy_id, password_hash_phc)
           VALUES ($1, $2, $3, 'argon2id-v1', $4)`,
          [ids.accountId, subject.emailNormalized, subject.emailVerifiedAt, subject.passwordHashPhc],
        );
        fault?.("account");
      }
      await client.query("INSERT INTO identity_account_security_states (account_id) VALUES ($1) ON CONFLICT (account_id) DO NOTHING", [ids.accountId]);

      const workspace = await client.query(
        "SELECT workspace_id, account_id FROM workspace_workspaces WHERE workspace_id = $1",
        [ids.workspaceId],
      );
      const workspaceRow = parseOptionalRow(readSingleRow(workspace), ["workspace_id", "account_id"], (row) =>
        typeof row.workspace_id === "string" && typeof row.account_id === "string");
      if (workspaceRow !== undefined && workspaceRow.account_id !== ids.accountId) throw new AccountActivationError("workspace identity conflict");
      if (workspaceRow === undefined) {
        await client.query(
          "INSERT INTO workspace_workspaces (workspace_id, account_id, kind, name) VALUES ($1, $2, 'personal', 'Personal workspace')",
          [ids.workspaceId, ids.accountId],
        );
        fault?.("workspace");
      }

      const binding = await client.query(
        "SELECT account_id, workspace_id, role, is_default FROM workspace_account_bindings WHERE account_id = $1 AND workspace_id = $2",
        [ids.accountId, ids.workspaceId],
      );
      const bindingRow = parseOptionalRow(readSingleRow(binding), ["account_id", "workspace_id", "role", "is_default"], (row) =>
        typeof row.account_id === "string" && typeof row.workspace_id === "string" && typeof row.role === "string" && typeof row.is_default === "boolean");
      if (bindingRow !== undefined && (bindingRow.role !== "default_owner" || bindingRow.is_default !== true || bindingRow.account_id !== ids.accountId || bindingRow.workspace_id !== ids.workspaceId)) throw new AccountActivationError("binding identity conflict");
      if (bindingRow === undefined) {
        await client.query(
          `INSERT INTO workspace_account_bindings
             (account_id, workspace_id, owner_kind, role, is_default)
           VALUES ($1, $2, 'account', 'default_owner', true)`,
          [ids.accountId, ids.workspaceId],
        );
        fault?.("binding");
      }
      await client.query(
        `INSERT INTO workspace_revisions (account_id, workspace_id, workspace_schema_version)
         VALUES ($1, $2, 1) ON CONFLICT (account_id, workspace_id) DO NOTHING`,
        [ids.accountId, ids.workspaceId],
      );
      fault?.("initial-record");
      await client.query("COMMIT");
      open = false;
      client.release?.();
      return { state: "active", accountId: ids.accountId, workspaceId: ids.workspaceId };
    } catch (error) {
      if (open) {
        try { await client.query("ROLLBACK"); } catch { /* release below still closes the failed transaction */ }
      }
      client.release?.(error instanceof Error ? error : new Error("activation failed"));
      if (isRetryable(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new AccountActivationError("activation retry budget exhausted");
}

export function parseActivationIntent(value: unknown): { readonly schemaVersion: 1 } {
  if (!hasExactDataProperties(value, ["schemaVersion"]) || (value as Record<string, unknown>).schemaVersion !== 1) throw new AccountActivationError("activation intent is invalid");
  return { schemaVersion: 1 };
}

export function parseAuthenticatedSubject(value: unknown): AuthenticatedSubject {
  if (!hasExactDataProperties(value, ["stableSubject", "emailNormalized", "emailVerifiedAt", "passwordHashPhc", "clientKind", "expiresAt", "revoked", "securityEpoch"])) throw new AccountActivationError("authenticated subject is invalid");
  if (typeof value.stableSubject !== "string" || value.stableSubject.length < 1 || value.stableSubject.length > 512 || value.stableSubject.startsWith("fixture-")) throw new AccountActivationError("authenticated subject is invalid");
  if (typeof value.emailNormalized !== "string" || value.emailNormalized.length < 3 || value.emailNormalized.length > 320 || /[\u0000-\u001f\u007f]/u.test(value.emailNormalized)) throw new AccountActivationError("authenticated subject is invalid");
  if (typeof value.emailVerifiedAt !== "string" || !Number.isFinite(Date.parse(value.emailVerifiedAt))) throw new AccountActivationError("authenticated subject is invalid");
  if (typeof value.passwordHashPhc !== "string" || value.passwordHashPhc.length < 80 || value.passwordHashPhc.length > 160) throw new AccountActivationError("authenticated subject is invalid");
  if (value.clientKind !== "account_web" || typeof value.expiresAt !== "string" || Date.parse(value.expiresAt) <= Date.now() || value.revoked !== false || typeof value.securityEpoch !== "number" || !Number.isSafeInteger(value.securityEpoch) || value.securityEpoch < 1) throw new AccountActivationError("authenticated subject is invalid");
  return value as unknown as AuthenticatedSubject;
}

function derivedIds(stableSubject: string): { readonly accountId: string; readonly workspaceId: string } {
  const digest = createHash("sha256").update(stableSubject, "utf8").digest("hex");
  return { accountId: `account-${digest.slice(0, 48)}`, workspaceId: `workspace-${digest.slice(0, 48)}` };
}
function isRetryable(error: unknown): boolean { return isCode(error, "40001") || isCode(error, "40P01"); }
function isCode(error: unknown, code: string): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === code; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function readSingleRow(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.rows) || value.rows.length > 1 ||
      (Object.hasOwn(value, "rowCount") && (typeof value.rowCount !== "number" || value.rowCount !== value.rows.length))) {
    throw new AccountActivationError("activation database result is invalid");
  }
  return value.rows[0];
}
function hasExactDataProperties(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key))) return false;
  return expected.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value") && !Object.hasOwn(descriptor, "get") && !Object.hasOwn(descriptor, "set");
  });
}
function parseOptionalRow(value: unknown, keys: readonly string[], valid: (row: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!hasExactDataProperties(value, keys) || !valid(value)) {
    throw new AccountActivationError("activation database row is invalid");
  }
  return value;
}
