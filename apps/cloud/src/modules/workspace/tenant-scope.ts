import { identifier } from "@gooddealer/protocol/wire";

/** Trusted workspace binding resolved before any workspace data-plane operation. */
export interface WorkspaceTenantScope {
  readonly accountId: string;
  readonly workspaceId: string;
}

export function parseWorkspaceTenantScope(value: unknown): WorkspaceTenantScope | null {
  if (!isPlainObject(value)) return null;

  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("accountId") || !keys.includes("workspaceId")) return null;

  const accountIdDescriptor = Object.getOwnPropertyDescriptor(value, "accountId");
  const workspaceIdDescriptor = Object.getOwnPropertyDescriptor(value, "workspaceId");
  if (!isEnumerableDataProperty(accountIdDescriptor) || !isEnumerableDataProperty(workspaceIdDescriptor)) {
    return null;
  }

  const accountId = identifier.safeParse(accountIdDescriptor.value);
  const workspaceId = identifier.safeParse(workspaceIdDescriptor.value);
  if (!accountId.success || !workspaceId.success) return null;
  return { accountId: accountId.data, workspaceId: workspaceId.data };
}

export function workspaceTenantKey(scope: WorkspaceTenantScope): string {
  const parsed = parseWorkspaceTenantScope(scope);
  if (parsed === null) throw new TypeError("workspace tenant scope is unresolved");
  return `${parsed.accountId}\u0000${parsed.workspaceId}`;
}

/** Only an exact successful activation result may derive this scope. */
export function activationTenantScope(result: unknown): WorkspaceTenantScope {
  if (!isPlainObject(result)) throw new TypeError("activation tenant scope is unresolved");
  const keys = Reflect.ownKeys(result);
  if (keys.length !== 3 || !keys.includes("state") || !keys.includes("accountId") || !keys.includes("workspaceId")) {
    throw new TypeError("activation tenant scope is unresolved");
  }
  const state = Object.getOwnPropertyDescriptor(result, "state");
  const accountId = Object.getOwnPropertyDescriptor(result, "accountId");
  const workspaceId = Object.getOwnPropertyDescriptor(result, "workspaceId");
  if (!isEnumerableDataProperty(state) || state.value !== "active" ||
      !isEnumerableDataProperty(accountId) || !isEnumerableDataProperty(workspaceId)) {
    throw new TypeError("activation tenant scope is unresolved");
  }
  const parsed = parseWorkspaceTenantScope({ accountId: accountId.value, workspaceId: workspaceId.value });
  if (parsed === null) throw new TypeError("activation tenant scope is unresolved");
  return parsed;
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isEnumerableDataProperty(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { readonly value: unknown } {
  return descriptor !== undefined && descriptor.enumerable === true && "value" in descriptor;
}
