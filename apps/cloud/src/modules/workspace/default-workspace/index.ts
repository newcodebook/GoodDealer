import { identifier } from "@gooddealer/protocol/wire";

import type { AccountTransaction, AccountTransactionRunner } from "../../../db/index";
import type { PublicPrincipal } from "../../../entrypoints/ports/public-session";
import {
  parseWorkspaceTenantScope,
  type WorkspaceTenantScope,
} from "../tenant-scope";

export { accountDefaultWorkspaceMigration } from "./migrations/202608200014-account-default-workspace";

export interface DefaultWorkspaceTenantResolverPort {
  resolve(principal: PublicPrincipal): Promise<WorkspaceTenantScope | null>;
}

type AccountTransactions = Pick<AccountTransactionRunner, "withAccount">;

/** Resolves the sole default account-owned binding without accepting workspace authority. */
export class PostgresDefaultWorkspaceTenantResolver implements DefaultWorkspaceTenantResolverPort {
  constructor(private readonly transactions: AccountTransactions) {}

  async resolve(principalValue: PublicPrincipal): Promise<WorkspaceTenantScope | null> {
    const principal = parsePrincipal(principalValue);
    if (principal === null) return null;
    return this.transactions.withAccount(principal.accountId, async (transaction) =>
      resolveDefaultWorkspace(transaction, principal.accountId));
  }
}

async function resolveDefaultWorkspace(
  transaction: AccountTransaction,
  accountId: string,
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
  if (!Array.isArray(result.rows) || result.rows.length !== 1) return null;
  const row = result.rows[0];
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
  if (!hasExactDataProperties(value, ["accountId", "sessionId", "clientKind"])) return null;
  const accountId = identifier.safeParse(value.accountId);
  const sessionId = identifier.safeParse(value.sessionId);
  if (!accountId.success || !sessionId.success) return null;
  if (value.clientKind !== "account_web" && value.clientKind !== "desktop") return null;
  return { accountId: accountId.data, sessionId: sessionId.data, clientKind: value.clientKind };
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
