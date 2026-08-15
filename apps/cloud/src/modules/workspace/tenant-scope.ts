import { identifier } from "@gooddealer/protocol/wire";

/** Trusted workspace binding resolved before any workspace data-plane operation. */
export interface WorkspaceTenantScope {
  readonly accountId: string;
  readonly workspaceId: string;
}

export function parseWorkspaceTenantScope(value: unknown): WorkspaceTenantScope | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("accountId") || !keys.includes("workspaceId")) return null;
  const accountId = identifier.safeParse(value.accountId);
  const workspaceId = identifier.safeParse(value.workspaceId);
  if (!accountId.success || !workspaceId.success) return null;
  return { accountId: accountId.data, workspaceId: workspaceId.data };
}

export function workspaceTenantKey(scope: WorkspaceTenantScope): string {
  const parsed = parseWorkspaceTenantScope(scope);
  if (parsed === null) throw new TypeError("workspace tenant scope is unresolved");
  return `${parsed.accountId}\u0000${parsed.workspaceId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
