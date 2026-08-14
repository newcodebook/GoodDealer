export type AdminBoundaryAuditOutcome = "access" | "denial";
export type AdminBoundaryAuditReason =
  | "authenticated_access"
  | "authentication_failed"
  | "insufficient_scope"
  | "not_found"
  | "payload_too_large"
  | "rate_limited"
  | "unsupported_media_type"
  | "unexpected_error";

/** This is a test-visible boundary record, not an AuditEvent or an audit chain. */
export interface AdminBoundaryAuditRecord {
  readonly correlationId: string;
  readonly outcome: AdminBoundaryAuditOutcome;
  readonly reason: AdminBoundaryAuditReason;
  readonly method: string;
  readonly path: string;
}

export interface AuditSinkPort {
  record(record: AdminBoundaryAuditRecord): void | Promise<void>;
}

export class InMemoryAuditSink implements AuditSinkPort {
  readonly #records: AdminBoundaryAuditRecord[] = [];

  record(record: AdminBoundaryAuditRecord): void {
    this.#records.push({ ...record });
  }

  records(): readonly AdminBoundaryAuditRecord[] {
    return this.#records.map((record) => ({ ...record }));
  }
}
