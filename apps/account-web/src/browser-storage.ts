/**
 * Keeps browser recovery custody partitioned by the server-authenticated account
 * namespace. The namespace is opaque and never derived from browser input.
 */
export interface NamespacedRecoveryStore<T> {
  load(): Promise<unknown>;
  save(value: T): Promise<void>;
  clear(): Promise<void>;
}

export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const NAMESPACE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const ACTIVE_ACCOUNT_NAMESPACE_KEY = "gooddealer.identity.active-account-namespace.v1";

export function supersedeGeneration(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0 || current === Number.MAX_SAFE_INTEGER) {
    throw new TypeError("browser generation is invalid");
  }
  return current + 1;
}

export interface AccountNamespaceFence {
  activate(namespace: string): void;
  isCurrent(namespace: string): boolean;
  clear(): void;
}

export function createAccountNamespaceFence(storage?: RecoveryStorage): AccountNamespaceFence {
  const browserStorage = storage ?? defaultStorage();
  return {
    activate(namespace): void {
      if (!NAMESPACE_PATTERN.test(namespace)) throw new TypeError("authenticated account namespace is invalid");
      browserStorage.setItem(ACTIVE_ACCOUNT_NAMESPACE_KEY, namespace);
    },
    isCurrent(namespace): boolean {
      return NAMESPACE_PATTERN.test(namespace)
        && browserStorage.getItem(ACTIVE_ACCOUNT_NAMESPACE_KEY) === namespace;
    },
    clear(): void {
      browserStorage.removeItem(ACTIVE_ACCOUNT_NAMESPACE_KEY);
    },
  };
}

export function createNamespacedRecoveryStore<T>(
  baseKey: string,
  namespace: string,
  storage?: RecoveryStorage,
): NamespacedRecoveryStore<T> {
  if (!/^[a-z0-9.-]+$/u.test(baseKey)) throw new TypeError("recovery storage key is invalid");
  if (!NAMESPACE_PATTERN.test(namespace)) throw new TypeError("authenticated account namespace is invalid");
  const browserStorage = storage ?? defaultStorage();

  function key(): string {
    return recoveryStorageKey(baseKey, namespace);
  }

  return {
    async load(): Promise<unknown> {
      const raw = browserStorage.getItem(key());
      if (raw === null) return null;
      try { return JSON.parse(raw) as unknown; } catch { return null; }
    },
    async save(value: T): Promise<void> {
      browserStorage.setItem(key(), JSON.stringify(value));
    },
    async clear(): Promise<void> {
      browserStorage.removeItem(key());
    },
  };
}

export function recoveryStorageKey(baseKey: string, namespace: string): string {
  if (!/^[a-z0-9.-]+$/u.test(baseKey) || !NAMESPACE_PATTERN.test(namespace)) {
    throw new TypeError("recovery storage identity is invalid");
  }
  return `${baseKey}.v2.${namespace}`;
}

export function parseAuthenticatedIdentitySession(value: unknown): { readonly namespace: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("status") || !keys.includes("namespace")) return null;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return null;
  }
  const status = Reflect.get(value, "status");
  const namespace = Reflect.get(value, "namespace");
  return status === "authenticated" && typeof namespace === "string" && NAMESPACE_PATTERN.test(namespace)
    ? { namespace }
    : null;
}

function defaultStorage(): RecoveryStorage {
  if (typeof globalThis.localStorage === "undefined") {
    throw new Error("browser recovery storage is unavailable");
  }
  return globalThis.localStorage;
}
