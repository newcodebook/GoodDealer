import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  MAX_MUTATIONS_PER_PAGE,
  encodeMutationPageDigestInput,
  mutationPageSchema,
  type MutationPage,
} from "@gooddealer/protocol/workspace";
import { identifier } from "@gooddealer/protocol/wire";

import { type TenantTransaction, TenantTransactionRunner } from "../../../db/index";
import {
  PostgresReaderCursorRepository,
  type PostgresReaderCursorSnapshot,
} from "./postgres-reader-cursor-repository";

export interface LockedReaderWorkspaceRevision {
  readonly serverRevision: number;
  readonly compactedThroughServerRevision: number;
}

/** Implemented by workspace/revisions so cursors never query another capability's table. */
export interface ReaderWorkspaceRevisionLockPort {
  lock(transaction: TenantTransaction): Promise<LockedReaderWorkspaceRevision | null>;
}

/** A transaction-aware, dense range query; it grants no Mutation write capability. */
export interface ReaderMutationPageQueryPort {
  readPage(transaction: TenantTransaction, input: {
    readonly fromServerRevisionExclusive: number;
    readonly throughServerRevisionInclusive: number;
    readonly pageLimit: number;
  }): Promise<unknown>;
}

export interface ReaderCursorPresentation {
  readonly generation: number;
  readonly rowVersion: number;
  readonly continuationToken: string | null;
}

export interface PersistentReaderCursorProjection {
  readonly deviceId: string;
  readonly generation: number;
  readonly rowVersion: number;
  readonly readThroughServerRevision: number;
  readonly leaseExpiresAt: string;
  readonly status: "active" | "retired";
  readonly resumeRequirement: "none" | "rebootstrap_required";
  readonly retiredAt: string | null;
  readonly retiredReason: "ttl_expired" | "compaction_race" | "device_removed" | null;
}

export type PersistentReaderCursorRejectionCode =
  | "WORKSPACE_TENANT_UNRESOLVED"
  | "READER_CURSOR_UNKNOWN"
  | "READER_CURSOR_RETIRED"
  | "READER_CURSOR_TTL_EXPIRED"
  | "READER_CURSOR_COMPACTION_RACE"
  | "READER_CURSOR_DEVICE_REMOVED"
  | "CURSOR_REVISION_REGRESSION"
  | "READER_CURSOR_STALE_PRESENTATION"
  | "READER_CURSOR_STORAGE_INVALID";

export type PersistentReaderCursorResult =
  | {
    readonly accepted: true;
    readonly cursor: PersistentReaderCursorProjection;
    readonly presentation: ReaderCursorPresentation;
  }
  | { readonly accepted: false; readonly code: PersistentReaderCursorRejectionCode };

export type PersistentReaderCursorPageResult =
  | {
    readonly accepted: true;
    readonly cursor: PersistentReaderCursorProjection;
    readonly presentation: ReaderCursorPresentation;
    readonly page: MutationPage;
  }
  | { readonly accepted: false; readonly code: PersistentReaderCursorRejectionCode };

export class PostgresReaderCursorService {
  readonly #leaseTtlSeconds: number;

  constructor(private readonly options: {
    readonly transactions: TenantTransactionRunner;
    readonly revisions: ReaderWorkspaceRevisionLockPort;
    readonly cursors: PostgresReaderCursorRepository;
    readonly pages: ReaderMutationPageQueryPort;
    readonly leaseTtlSeconds?: number;
  }) {
    this.#leaseTtlSeconds = options.leaseTtlSeconds ?? 15 * 60;
    assertTtl(this.#leaseTtlSeconds);
  }

  async open(
    scope: unknown,
    inputValue: unknown,
  ): Promise<PersistentReaderCursorResult> {
    const input = parseOpenInput(inputValue);
    return this.options.transactions.withTenant(scope, async (transaction) => {
      const head = await this.options.revisions.lock(transaction);
      if (head === null) return reject("WORKSPACE_TENANT_UNRESOLVED");
      if (input.atRevision < head.compactedThroughServerRevision) return reject("READER_CURSOR_COMPACTION_RACE");
      if (input.atRevision > head.serverRevision) return reject("CURSOR_REVISION_REGRESSION");
      const existing = await this.options.cursors.lock(transaction, input.deviceId);
      if (existing === null) {
        const created = await this.options.cursors.insertActive(
          transaction, input.deviceId, input.atRevision, this.#leaseTtlSeconds,
        );
        return accept(created, null);
      }
      if (existing.retirementReason === "device_removed") return reject("READER_CURSOR_DEVICE_REMOVED");
      if (existing.status === "retired") return reject("READER_CURSOR_RETIRED");
      const expired = await this.options.cursors.retireIfExpired(transaction, existing);
      if (expired !== null) return reject("READER_CURSOR_TTL_EXPIRED");
      if (existing.readThroughServerRevision !== input.atRevision || existing.pinnedPageTargetServerRevision !== null) {
        return reject("CURSOR_REVISION_REGRESSION");
      }
      return accept(existing, null);
    });
  }

  async reopenAfterRebootstrap(
    scope: unknown,
    inputValue: unknown,
  ): Promise<PersistentReaderCursorResult> {
    const input = parseReopenInput(inputValue);
    return this.options.transactions.withTenant(scope, async (transaction) => {
      const head = await this.options.revisions.lock(transaction);
      if (head === null) return reject("WORKSPACE_TENANT_UNRESOLVED");
      if (input.baselineServerRevision < head.compactedThroughServerRevision) return reject("READER_CURSOR_COMPACTION_RACE");
      if (input.baselineServerRevision > head.serverRevision) return reject("CURSOR_REVISION_REGRESSION");
      const cursor = await this.options.cursors.lock(transaction, input.deviceId);
      if (cursor === null) return reject("READER_CURSOR_UNKNOWN");
      if (cursor.retirementReason === "device_removed") return reject("READER_CURSOR_DEVICE_REMOVED");
      if (cursor.status !== "retired" || cursor.resumeRequirement !== "rebootstrap_required") {
        return reject("READER_CURSOR_RETIRED");
      }
      if (cursor.generation !== input.generation || cursor.rowVersion !== input.rowVersion) {
        return reject("READER_CURSOR_STALE_PRESENTATION");
      }
      const reopened = await this.options.cursors.reopenAfterRebootstrap(
        transaction, cursor, input.baselineServerRevision, this.#leaseTtlSeconds,
      );
      return accept(reopened, null);
    });
  }

  async renew(
    scope: unknown,
    inputValue: unknown,
  ): Promise<PersistentReaderCursorResult> {
    const input = parsePresentationInput(inputValue, false);
    return this.options.transactions.withTenant(scope, async (transaction) => {
      const head = await this.options.revisions.lock(transaction);
      if (head === null) return reject("WORKSPACE_TENANT_UNRESOLVED");
      const checked = await this.lockPresentedCursor(transaction, input);
      if (!checked.accepted) return checked;
      if (checked.cursor.readThroughServerRevision < head.compactedThroughServerRevision) {
        await this.options.cursors.retire(transaction, checked.cursor, "compaction_race");
        return reject("READER_CURSOR_COMPACTION_RACE");
      }
      const renewed = await this.options.cursors.renew(transaction, checked.cursor, this.#leaseTtlSeconds);
      if (renewed === null) {
        await this.options.cursors.retireIfExpired(transaction, checked.cursor);
        return reject("READER_CURSOR_TTL_EXPIRED");
      }
      return accept(renewed, input.continuationToken);
    });
  }

  async readAfter(
    scope: unknown,
    inputValue: unknown,
  ): Promise<PersistentReaderCursorPageResult> {
    const input = parsePresentationInput(inputValue, true);
    return this.options.transactions.withTenant(scope, async (transaction) => {
      const head = await this.options.revisions.lock(transaction);
      if (head === null) return reject("WORKSPACE_TENANT_UNRESOLVED");
      const checked = await this.lockPresentedCursor(transaction, input);
      if (!checked.accepted) return checked;
      const cursor = checked.cursor;
      if (cursor.readThroughServerRevision < head.compactedThroughServerRevision) {
        await this.options.cursors.retire(transaction, cursor, "compaction_race");
        return reject("READER_CURSOR_COMPACTION_RACE");
      }
      const target = cursor.pinnedPageTargetServerRevision ?? head.serverRevision;
      let page: MutationPage;
      try {
        page = mutationPageSchema.parse(await this.options.pages.readPage(transaction, {
          fromServerRevisionExclusive: cursor.readThroughServerRevision,
          throughServerRevisionInclusive: target,
          pageLimit: input.pageLimit,
        }));
        assertPage(page, transaction.scope.workspaceId, cursor.readThroughServerRevision, target);
      } catch {
        return reject("READER_CURSOR_STORAGE_INVALID");
      }

      const terminal = page.nextCursor === null;
      const continuationToken = terminal ? null : randomBytes(32).toString("base64url");
      const updated = await this.options.cursors.advancePage(
        transaction,
        cursor,
        page.returnedThroughServerRevision,
        terminal ? null : target,
        terminal ? null : page.returnedThroughServerRevision + 1,
        continuationToken === null ? null : digestToken(continuationToken),
      );
      return {
        accepted: true,
        cursor: project(updated),
        presentation: present(updated, continuationToken),
        page,
      };
    });
  }

  private async lockPresentedCursor(
    transaction: TenantTransaction,
    input: PresentedInput,
  ): Promise<
    | { readonly accepted: true; readonly cursor: PostgresReaderCursorSnapshot }
    | { readonly accepted: false; readonly code: PersistentReaderCursorRejectionCode }
  > {
    const cursor = await this.options.cursors.lock(transaction, input.deviceId);
    if (cursor === null) return reject("READER_CURSOR_UNKNOWN");
    if (cursor.retirementReason === "device_removed") return reject("READER_CURSOR_DEVICE_REMOVED");
    if (cursor.status === "retired") return reject("READER_CURSOR_RETIRED");
    const expired = await this.options.cursors.retireIfExpired(transaction, cursor);
    if (expired !== null) return reject("READER_CURSOR_TTL_EXPIRED");
    if (cursor.generation !== input.generation || cursor.rowVersion !== input.rowVersion ||
        !matchesToken(cursor.continuationTokenDigest, input.continuationToken)) {
      return reject("READER_CURSOR_STALE_PRESENTATION");
    }
    return { accepted: true, cursor };
  }
}

interface PresentedInput {
  readonly deviceId: string;
  readonly generation: number;
  readonly rowVersion: number;
  readonly continuationToken: string | null;
  readonly pageLimit: number;
}

function parseOpenInput(value: unknown): { readonly deviceId: string; readonly atRevision: number } {
  const record = exactRecord(value, ["deviceId", "atRevision"]);
  return { deviceId: identifier.parse(record.deviceId), atRevision: parseRevision(record.atRevision) };
}

function parseReopenInput(value: unknown): {
  readonly deviceId: string;
  readonly baselineServerRevision: number;
  readonly generation: number;
  readonly rowVersion: number;
} {
  const record = exactRecord(value, ["deviceId", "baselineServerRevision", "generation", "rowVersion"]);
  return {
    deviceId: identifier.parse(record.deviceId),
    baselineServerRevision: parseRevision(record.baselineServerRevision),
    generation: parsePositive(record.generation),
    rowVersion: parsePositive(record.rowVersion),
  };
}

function parsePresentationInput(value: unknown, needsPageLimit: boolean): PresentedInput {
  const keys = needsPageLimit
    ? ["deviceId", "generation", "rowVersion", "continuationToken", "pageLimit"] as const
    : ["deviceId", "generation", "rowVersion", "continuationToken"] as const;
  const record = exactRecord(value, keys);
  const token = record.continuationToken;
  if (token !== null && (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(token))) {
    throw new TypeError("reader cursor continuation token is malformed");
  }
  return {
    deviceId: identifier.parse(record.deviceId),
    generation: parsePositive(record.generation),
    rowVersion: parsePositive(record.rowVersion),
    continuationToken: token,
    pageLimit: needsPageLimit ? parsePageLimit(record.pageLimit) : 1,
  };
}

function exactRecord<const Keys extends readonly string[]>(value: unknown, keys: Keys): Record<Keys[number], unknown> {
  if (!isSafeWireValue(value) || Array.isArray(value)) throw new TypeError("reader cursor input is malformed");
  const objectValue = value as object;
  const ownKeys = Reflect.ownKeys(objectValue);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string") ||
      keys.some((key) => !Object.prototype.hasOwnProperty.call(objectValue, key))) {
    throw new TypeError("reader cursor input is malformed");
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError("reader cursor input is malformed");
    }
  }
  return value as Record<Keys[number], unknown>;
}

function isSafeWireValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1) return false;
    return ownKeys.every((key) => {
      if (key === "length") return true;
      if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key)) return false;
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && descriptor.enumerable === true && "value" in descriptor &&
        isSafeWireValue(descriptor.value, seen);
    });
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable === true && "value" in descriptor &&
      isSafeWireValue(descriptor.value, seen);
  });
}

function parseRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError("reader cursor revision is malformed");
  return value as number;
}

function parsePositive(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError("reader cursor presentation is malformed");
  return value as number;
}

function parsePageLimit(value: unknown): number {
  const parsed = parsePositive(value);
  if (parsed > MAX_MUTATIONS_PER_PAGE) throw new TypeError("reader cursor page limit is malformed");
  return parsed;
}

function assertTtl(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400) throw new TypeError("reader cursor TTL is malformed");
}

function assertPage(page: MutationPage, workspaceId: string, from: number, target: number): void {
  if (page.workspaceId !== workspaceId || page.fromServerRevisionExclusive !== from ||
      page.throughServerRevisionInclusive !== target) {
    throw new TypeError("stored mutation page escaped its reader cursor bounds");
  }
  const expectedDigest = createHash("sha256").update(encodeMutationPageDigestInput(page)).digest("base64url");
  if (page.pageDigest !== expectedDigest) throw new TypeError("stored mutation page digest is invalid");
}

function digestToken(token: string): Uint8Array {
  return createHash("sha256").update(token, "utf8").digest();
}

function matchesToken(expected: Uint8Array | null, token: string | null): boolean {
  if (expected === null || token === null) return expected === null && token === null;
  const actual = digestToken(token);
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}

function accept(cursor: PostgresReaderCursorSnapshot, token: string | null): PersistentReaderCursorResult {
  return { accepted: true, cursor: project(cursor), presentation: present(cursor, token) };
}

function reject(code: PersistentReaderCursorRejectionCode): {
  readonly accepted: false;
  readonly code: PersistentReaderCursorRejectionCode;
} {
  return { accepted: false, code };
}

function project(cursor: PostgresReaderCursorSnapshot): PersistentReaderCursorProjection {
  return {
    deviceId: cursor.deviceId,
    generation: cursor.generation,
    rowVersion: cursor.rowVersion,
    readThroughServerRevision: cursor.readThroughServerRevision,
    leaseExpiresAt: cursor.leaseExpiresAt,
    status: cursor.status,
    resumeRequirement: cursor.resumeRequirement,
    retiredAt: cursor.retiredAt,
    retiredReason: cursor.retirementReason,
  };
}

function present(cursor: PostgresReaderCursorSnapshot, token: string | null): ReaderCursorPresentation {
  return { generation: cursor.generation, rowVersion: cursor.rowVersion, continuationToken: token };
}
