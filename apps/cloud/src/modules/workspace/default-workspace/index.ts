import { identifier } from "@gooddealer/protocol/wire";

import type {
  AccountTransaction,
  AccountTransactionRunner,
  IdentityCapabilityTransactionRunner,
} from "../../../db/index";
import type { PublicPrincipal } from "../../../entrypoints/ports/public-session";
import {
  parseWorkspaceTenantScope,
  type WorkspaceTenantScope,
} from "../tenant-scope";

export { accountDefaultWorkspaceMigration } from "./migrations/202608200014-account-default-workspace";

export interface DefaultWorkspaceTenantResolverPort {
  resolve(principal: PublicPrincipal): Promise<WorkspaceTenantScope | null>;
}

/** Workspace-owned authority read for callers that already own the final account transaction. */
export interface LockedDefaultWorkspaceAuthorityPort {
  resolveLocked(transaction: AccountTransaction): Promise<WorkspaceTenantScope | null>;
}

type AccountTransactions = Pick<AccountTransactionRunner, "withAccount">
  | Pick<IdentityCapabilityTransactionRunner, "withAccountCredential">;

/** Resolves the sole default account-owned binding without accepting workspace authority. */
export class PostgresDefaultWorkspaceTenantResolver
implements DefaultWorkspaceTenantResolverPort, LockedDefaultWorkspaceAuthorityPort {
  constructor(private readonly transactions: AccountTransactions) {}

  async resolve(principalValue: PublicPrincipal): Promise<WorkspaceTenantScope | null> {
    const principal = parsePrincipal(principalValue);
    if (principal === null) return null;
    if ("withAccountCredential" in this.transactions) {
      if (principal.transactionCredential === undefined) return null;
      return this.transactions.withAccountCredential(
        principal.transactionCredential,
        "workspace_tenant",
        async (transaction) => resolveDefaultWorkspace(transaction, transaction.accountId),
      );
    }
    return this.transactions.withAccount(principal.accountId, async (transaction) =>
      resolveDefaultWorkspace(transaction, principal.accountId));
  }

  async resolveLocked(transaction: AccountTransaction): Promise<WorkspaceTenantScope | null> {
    const accountId = identifier.safeParse(transaction.accountId);
    if (!accountId.success) return null;
    return resolveDefaultWorkspace(transaction, accountId.data, true);
  }
}

async function resolveDefaultWorkspace(
  transaction: AccountTransaction,
  accountId: string,
  lock = false,
): Promise<WorkspaceTenantScope | null> {
  const result = await transaction.query(
    `SELECT account_id, workspace_id
       FROM workspace_account_bindings
      WHERE account_id = $1
        AND owner_kind = 'account'
        AND role = 'default_owner'
        AND is_default = true
      LIMIT 2`,
    [accountId],
  );
  const scope = parseDefaultWorkspaceRows(result.rows, accountId);
  if (scope === null || !lock) return scope;

  // The account-only policy may resolve the unique default, but PostgreSQL row locks also apply the
  // tenant UPDATE policy. Install only the validated selector, then lock and revalidate the exact row.
  await transaction.query("SELECT set_config('gooddealer.workspace_id', $1, true)", [scope.workspaceId]);
  const locked = await transaction.query(
    `SELECT account_id, workspace_id
       FROM workspace_account_bindings
      WHERE account_id = $1 AND workspace_id = $2
        AND owner_kind = 'account'
        AND role = 'default_owner'
        AND is_default = true
      LIMIT 2
      FOR SHARE`,
    [accountId, scope.workspaceId],
  );
  const lockedScope = parseDefaultWorkspaceRows(locked.rows, accountId);
  return lockedScope?.workspaceId === scope.workspaceId ? lockedScope : null;
}

function parseDefaultWorkspaceRows(rows: unknown, accountId: string): WorkspaceTenantScope | null {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  if (!hasExactDataProperties(row, ["account_id", "workspace_id"])) return null;
  const parsedAccountId = identifier.safeParse(row.account_id);
  const parsedWorkspaceId = identifier.safeParse(row.workspace_id);
  if (!parsedAccountId.success || !parsedWorkspaceId.success || parsedAccountId.data !== accountId) return null;
  return parseWorkspaceTenantScope({
    accountId: parsedAccountId.data,
    workspaceId: parsedWorkspaceId.data,
  });
}

function parsePrincipal(value: unknown): PublicPrincipal | null {
  if (!hasRequiredDataProperties(value, ["accountId", "sessionId", "clientKind"])) return null;
  const accountId = identifier.safeParse(value.accountId);
  const sessionId = identifier.safeParse(value.sessionId);
  if (!accountId.success || !sessionId.success) return null;
  if (value.clientKind !== "account_web" && value.clientKind !== "desktop") return null;
  const credential = value.transactionCredential;
  if (credential !== undefined && !(credential instanceof Uint8Array)) return null;
  return {
    accountId: accountId.data,
    sessionId: sessionId.data,
    clientKind: value.clientKind,
    ...(credential === undefined ? {} : { transactionCredential: credential }),
  };
}

function hasRequiredDataProperties(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string"
      || (!keys.includes(key) && key !== "transactionCredential"))) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasExactDataProperties(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor;
  });
}
