import { createHash, timingSafeEqual } from "node:crypto";

import {
  SERVER_AUDIT_EVENT_SCHEMA_VERSION,
  encodeServerAuditChainDomain,
  encodeServerAuditEventHashInput,
  encodeServerAuditEventSignatureTranscript,
  persistedServerAuditEventSchema,
  serverAuditEventDraftSchema,
  type PersistedServerAuditEvent,
  type ServerAuditChainDomain,
  type ServerAuditEventDraft,
  type ServiceAuditEvent,
  type StaffAuditEvent,
  type UserAuditEvent,
} from "@gooddealer/protocol/audit";

type ServerAuditKind = "user" | "staff" | "service";
type ServerAuditSigningPurpose = "user_audit" | "staff_audit" | "service_audit";

/**
 * These fixed codes are the complete digest-only rejection vocabulary accepted by candidate
 * M013. Context failures deliberately do not appear here: an untrusted context is never
 * consumed and therefore never produces quarantine evidence.
 */
type ServerAuditRejectionCode =
  | "schema_invalid"
  | "canonical_conflict"
  | "transition_invalid"
  | "signer_invalid"
  | "append_conflict";

const identifierPattern = /^[!-~]{1,160}$/u;
const digestPattern = /^[A-Za-z0-9_-]{43}$/u;
const canonicalSignaturePattern = /^[A-Za-z0-9_-]+$/u;
const transitionAction = "audit_signing_key_transition" as const;
const placeholderSignature = "AA";

/**
 * The first ordinary record in a server chain always has a deterministic predecessor. It is
 * private to Cloud because the protocol's public hash contract intentionally does not prescribe
 * storage-head mechanics.
 */
const serverAuditChainGenesisHash = createHash("sha256")
  .update("GOODDEALER-SERVER-AUDIT-CHAIN-GENESIS-V1", "utf8")
  .digest("base64url");

interface BoundAuditTransaction {
  readonly transaction: object;
  readonly domainScope: AuditDomainScope;
}

type AuditDomainScope =
  | { readonly tenantScope: "global"; readonly accountId: null; readonly workspaceId: null }
  | { readonly tenantScope: "account"; readonly accountId: string; readonly workspaceId: null }
  | { readonly tenantScope: "workspace"; readonly accountId: string; readonly workspaceId: string };

interface InternalAuditContext {
  readonly kind: ServerAuditKind;
  readonly transaction: object;
  readonly domain: ServerAuditChainDomain;
  readonly auditEventId: string;
  readonly targetType: string;
  readonly targetRef: string;
  readonly authorizationContextHash: string;
  readonly cryptographicSignerId: string;
  readonly signingKeyId: string;
  readonly signingKeyVersion: number;
  readonly authorizationSource:
    | "user_session"
    | "admin_read_authorization"
    | "admin_action_authorization"
    | "service_identity"
    | "tenant_job_context";
  consumed: boolean;
}

interface ParsedContextIssue {
  readonly transaction: object;
  readonly auditEventId: string;
  readonly actorId: string;
  readonly targetType: string;
  readonly targetRef: string;
  readonly authorizationContextHash: string;
  readonly cryptographicSignerId: string;
  readonly signingKeyId: string;
  readonly signingKeyVersion: number;
  readonly authorizationSource?: InternalAuditContext["authorizationSource"];
}

/**
 * This issuer is intentionally not re-exported by the audit module entrypoint. A future
 * composition root must keep it behind verified User, Staff, Service, and security-state
 * authorities. Its weak bindings make casts, copies, and cross-transaction replay fail closed.
 */
export class ServerAuditContextIssuer {
  readonly #transactions = new WeakMap<object, BoundAuditTransaction>();
  readonly #contexts = new WeakMap<object, InternalAuditContext>();

  bindWorkspaceTransaction(transaction: unknown, scope: unknown): void {
    const token = parseTransactionToken(transaction);
    const parsedScope = parseWorkspaceScope(scope);
    this.#bind(token, parsedScope);
  }

  bindAccountTransaction(transaction: unknown, accountId: unknown): void {
    const token = parseTransactionToken(transaction);
    this.#bind(token, { tenantScope: "account", accountId: parseIdentifier(accountId, "account id"), workspaceId: null });
  }

  /** Global audit transactions are audit-private; this does not add a database-wide runner. */
  bindPrivateGlobalTransaction(transaction: unknown): void {
    const token = parseTransactionToken(transaction);
    this.#bind(token, { tenantScope: "global", accountId: null, workspaceId: null });
  }

  issueUser(value: unknown): unknown {
    const input = parseContextIssue(value, false);
    return this.#issue("user", input, "user_session");
  }

  issueStaff(value: unknown): unknown {
    const input = parseContextIssue(value, true);
    if (input.authorizationSource !== "admin_read_authorization" && input.authorizationSource !== "admin_action_authorization") {
      throw new TypeError("staff audit authorization source is unresolved");
    }
    return this.#issue("staff", input, input.authorizationSource);
  }

  issueService(value: unknown): unknown {
    const input = parseContextIssue(value, true);
    if (input.authorizationSource !== "service_identity" && input.authorizationSource !== "tenant_job_context") {
      throw new TypeError("service audit authorization source is unresolved");
    }
    return this.#issue("service", input, input.authorizationSource);
  }

  consume(value: unknown, expectedKind: ServerAuditKind): InternalAuditContext {
    if (typeof value !== "object" || value === null) throw new TypeError("audit context is untrusted");
    const context = this.#contexts.get(value);
    if (context === undefined || context.kind !== expectedKind || context.consumed) {
      throw new TypeError("audit context is untrusted");
    }
    context.consumed = true;
    return context;
  }

  #bind(transaction: object, domainScope: AuditDomainScope): void {
    const existing = this.#transactions.get(transaction);
    if (existing !== undefined && !sameDomainScope(existing.domainScope, domainScope)) {
      throw new TypeError("audit transaction scope cannot be rebound");
    }
    if (existing === undefined) this.#transactions.set(transaction, { transaction, domainScope });
  }

  #issue(
    kind: ServerAuditKind,
    input: ParsedContextIssue,
    authorizationSource: InternalAuditContext["authorizationSource"],
  ): unknown {
    const binding = this.#transactions.get(input.transaction);
    if (binding === undefined) throw new TypeError("audit transaction is untrusted");
    if (kind === "user" && binding.domainScope.tenantScope === "global") {
      throw new TypeError("user audit cannot use a global transaction");
    }
    if (kind === "user") assertUserTargetScope(binding.domainScope, input.targetType, input.targetRef);

    const domain = parseDomain({
      auditEventKind: kind,
      actorId: input.actorId,
      ...binding.domainScope,
    });
    const context = Object.freeze({});
    this.#contexts.set(context, {
      kind,
      transaction: binding.transaction,
      domain,
      auditEventId: input.auditEventId,
      targetType: input.targetType,
      targetRef: input.targetRef,
      authorizationContextHash: input.authorizationContextHash,
      cryptographicSignerId: input.cryptographicSignerId,
      signingKeyId: input.signingKeyId,
      signingKeyVersion: input.signingKeyVersion,
      authorizationSource,
      consumed: false,
    });
    return context;
  }
}

/** User records are emitted only from a context minted after a verified user session. */
export interface UserAuditPort {
  append(context: unknown, draft: unknown): Promise<UserAuditEvent>;
}

/** Staff records are emitted only from a context minted after a verified staff authorization. */
export interface StaffAuditPort {
  append(context: unknown, draft: unknown): Promise<StaffAuditEvent>;
}

/** Service records are emitted only from a service identity or tenant-job context. */
export interface ServiceAuditPort {
  append(context: unknown, draft: unknown): Promise<ServiceAuditEvent>;
}

/**
 * Security is a restricted source of truthful User, Staff, or Service records. It deliberately
 * has no separate event class, security actor, signing purpose, or chain.
 */
export interface SecurityAuditPort {
  emitAccountSecurity(context: unknown, draft: unknown): Promise<UserAuditEvent>;
  emitStaffIncidentAction(context: unknown, draft: unknown): Promise<StaffAuditEvent>;
  emitServiceDefense(context: unknown, draft: unknown): Promise<ServiceAuditEvent>;
}

export interface ServerAuditPorts {
  readonly user: UserAuditPort;
  readonly security: SecurityAuditPort;
  readonly staff: StaffAuditPort;
  readonly service: ServiceAuditPort;
}

export interface AuditChainHead {
  readonly chainId: string;
  readonly auditSequence: number;
  readonly eventHash: string;
}

/** A journal-issued, transaction-bound preparation; callers cannot select its head or time. */
export interface PreparedServerAuditAppend {
  readonly chainId: string;
  readonly auditSequence: number;
  readonly previousHash: string;
  readonly occurredAt: string;
}

export interface CommittedServerAuditEntry {
  readonly record: PersistedServerAuditEvent;
  readonly canonicalEvidence: Uint8Array;
}

export interface IncomingSignerUse {
  readonly hasPriorUse: boolean;
  readonly firstTransitionId: string | null;
}

/** Module-private persistence collaboration, intentionally not a generic audit repository. */
export interface ServerAuditAppendJournal {
  readCommittedByAuditEventId(transaction: object, auditEventId: string): Promise<CommittedServerAuditEntry | null>;
  prepareAppend(input: {
    readonly transaction: object;
    readonly chainId: string;
  }): Promise<PreparedServerAuditAppend>;
  appendCanonical(input: {
    readonly transaction: object;
    readonly prepared: PreparedServerAuditAppend;
    readonly entry: CommittedServerAuditEntry;
  }): Promise<
    | { readonly status: "appended"; readonly entry: CommittedServerAuditEntry }
    | { readonly status: "exact"; readonly entry: CommittedServerAuditEntry }
    | { readonly status: "conflict" }
  >;
  inspectIncomingSignerUse(input: {
    readonly transaction: object;
    readonly chainId: string;
    readonly signingKeyPurpose: ServerAuditSigningPurpose;
    readonly signingKeyId: string;
    readonly signingKeyVersion: number;
  }): Promise<IncomingSignerUse>;
  /**
   * A digest-only candidate recorded in the caller's existing transaction after a trusted
   * context has been consumed. An outer rollback can roll it back, so it is not a durable
   * rejection ledger or an autonomous side effect.
   */
  quarantineTrustedRejection(input: {
    readonly transaction: object;
    readonly rejectionCode: ServerAuditRejectionCode;
    readonly rejectionDigest: string;
  }): Promise<void>;
}

interface RecordSignerBinding {
  readonly auditEventKind: ServerAuditKind;
  readonly signingKeyPurpose: ServerAuditSigningPurpose;
  readonly cryptographicSignerId: string;
  readonly signingKeyId: string;
  readonly signingKeyVersion: number;
  readonly occurredAt: string;
}

/** A closed authority response; it is parsed from unknown before Cloud trusts it. */
type IncomingTransitionResolution =
  | { readonly status: "unchanged_current_signer" }
  | { readonly status: "required_transition"; readonly transition: ServiceAuditEvent };

/**
 * A private, purpose-specific authority boundary. It exposes neither key material nor a generic
 * public-key registry: the only queries are validation of a record signer and a transition edge.
 */
export interface ServerAuditSigningAuthority {
  assertCurrentRecordSigner(binding: RecordSignerBinding): Promise<void>;
  verifyCommittedRecordSignature(record: PersistedServerAuditEvent): Promise<void>;
  assertTransitionAffectedPair(transition: ServiceAuditEvent): Promise<void>;
  /**
   * The authority response crosses a trust boundary, even though the authority itself is
   * private. Cloud therefore receives unknown and accepts only a closed resolution below.
   */
  resolveIncomingTransition(input: {
    readonly transaction: object;
    readonly domain: ServerAuditChainDomain;
    readonly signingKeyPurpose: ServerAuditSigningPurpose;
    readonly signingKeyId: string;
    readonly signingKeyVersion: number;
    readonly occurredAt: string;
  }): Promise<unknown>;
}

interface AuditSigner {
  sign(input: {
    readonly transcript: Uint8Array;
    readonly signingKeyPurpose: ServerAuditSigningPurpose;
    readonly cryptographicSignerId: string;
    readonly signingKeyId: string;
    readonly signingKeyVersion: number;
  }): Promise<string>;
}

/**
 * Production intentionally remains unable to sign until a custodian-backed KMS/HSM and
 * revocation/rotation authority are approved. It never receives or stores key material.
 */
class DenyingProductionAuditSigner implements AuditSigner {
  async sign(_input: {
    readonly transcript: Uint8Array;
    readonly signingKeyPurpose: ServerAuditSigningPurpose;
    readonly cryptographicSignerId: string;
    readonly signingKeyId: string;
    readonly signingKeyVersion: number;
  }): Promise<string> {
    throw new TypeError("server audit signing is unavailable pending approved custodian authority");
  }
}

/**
 * The runtime is Cloud-internal and deliberately has no default journal or key authority. The
 * only default is the denying signer, so wiring this class cannot activate production signing.
 */
export class ServerAuditRuntime implements ServerAuditPorts {
  readonly user: UserAuditPort;
  readonly security: SecurityAuditPort;
  readonly staff: StaffAuditPort;
  readonly service: ServiceAuditPort;
  readonly #contexts: ServerAuditContextIssuer;
  readonly #journal: ServerAuditAppendJournal;
  readonly #authority: ServerAuditSigningAuthority;
  readonly #signer: AuditSigner;

  constructor(options: {
    readonly contexts: ServerAuditContextIssuer;
    readonly journal: ServerAuditAppendJournal;
    readonly authority: ServerAuditSigningAuthority;
    readonly signer?: AuditSigner;
  }) {
    this.#contexts = options.contexts;
    this.#journal = options.journal;
    this.#authority = options.authority;
    this.#signer = options.signer ?? new DenyingProductionAuditSigner();
    this.user = {
      append: async (context, draft) => this.#appendAs("user", context, draft),
    };
    this.staff = {
      append: async (context, draft) => this.#appendAs("staff", context, draft),
    };
    this.service = {
      append: async (context, draft) => this.#appendAs("service", context, draft),
    };
    this.security = {
      emitAccountSecurity: async (context, draft) => this.#appendAs("user", context, draft, ["account_security"]),
      emitStaffIncidentAction: async (context, draft) =>
        this.#appendAs("staff", context, draft, ["security_incident_staff_action"]),
      emitServiceDefense: async (context, draft) =>
        this.#appendAs("service", context, draft, ["identity_defense", "security_incident"]),
    };
  }

  async #appendAs(
    expectedKind: "user",
    contextValue: unknown,
    draftValue: unknown,
    allowedActions?: readonly ["account_security"],
  ): Promise<UserAuditEvent>;
  async #appendAs(
    expectedKind: "staff",
    contextValue: unknown,
    draftValue: unknown,
    allowedActions?: readonly ["security_incident_staff_action"],
  ): Promise<StaffAuditEvent>;
  async #appendAs(
    expectedKind: "service",
    contextValue: unknown,
    draftValue: unknown,
    allowedActions?: readonly ["identity_defense", "security_incident"],
  ): Promise<ServiceAuditEvent>;
  async #appendAs(
    expectedKind: ServerAuditKind,
    contextValue: unknown,
    draftValue: unknown,
    allowedActions?: readonly string[],
  ): Promise<PersistedServerAuditEvent> {
    const context = this.#contexts.consume(contextValue, expectedKind);
    let rejectionCode: ServerAuditRejectionCode = "schema_invalid";
    try {
      const draft = parseClosedDraft(draftValue);
      if (draft.auditEventKind !== expectedKind) throw new TypeError("audit draft kind does not match its trusted context");
      if (allowedActions !== undefined && !allowedActions.includes(draft.eventType)) {
        throw new TypeError("security emission action is not permitted");
      }
      if (draft.targetType !== context.targetType || draft.targetRef !== context.targetRef) {
        throw new TypeError("audit draft target does not match its trusted context");
      }

      rejectionCode = "canonical_conflict";
      const existing = await this.#journal.readCommittedByAuditEventId(context.transaction, context.auditEventId);
      if (existing !== null) {
        const record = this.#verifyExactReplay(context, draft, existing);
        rejectionCode = "signer_invalid";
        await this.#authority.verifyCommittedRecordSignature(record);
        return record;
      }

      rejectionCode = "append_conflict";
      const chainId = chainIdFor(context.domain);
      const prepared = await this.#journal.prepareAppend({ transaction: context.transaction, chainId });
      if (
        prepared.chainId !== chainId
        || !Number.isSafeInteger(prepared.auditSequence)
        || prepared.auditSequence < 1
        || !digestPattern.test(prepared.previousHash)
        || !isCanonicalTimestamp(prepared.occurredAt)
      ) {
        throw new TypeError("audit append preparation is invalid");
      }

      rejectionCode = "signer_invalid";
      await this.#authority.assertCurrentRecordSigner(recordSignerBinding(context, prepared.occurredAt));
      rejectionCode = "transition_invalid";
      const signingKeyTransitionId = draft.auditEventKind === "service" && draft.eventType === transitionAction
        ? null
        : await this.#resolveTransitionLink(context, chainId, prepared.occurredAt);
      const unsigned = buildUnsignedRecord({
        context,
        draft,
        prepared,
        signingKeyTransitionId,
      });
      const eventHash = digest(encodeAuditHashInput({
        ...unsigned,
        eventHash: serverAuditChainGenesisHash,
        serverSignature: placeholderSignature,
      }));
      const signingInput = {
        ...unsigned,
        eventHash,
        serverSignature: placeholderSignature,
      };
      rejectionCode = "signer_invalid";
      const signature = await this.#signer.sign({
        transcript: encodeAuditSignatureTranscript(signingInput),
        signingKeyPurpose: signingPurposeFor(expectedKind),
        cryptographicSignerId: context.cryptographicSignerId,
        signingKeyId: context.signingKeyId,
        signingKeyVersion: context.signingKeyVersion,
      });
      if (
        typeof signature !== "string"
        || !canonicalSignaturePattern.test(signature)
        || Buffer.from(signature, "base64url").toString("base64url") !== signature
      ) {
        throw new TypeError("audit signer returned an invalid signature");
      }
      const record = parsePersisted({ ...signingInput, serverSignature: signature });
      const entry = { record, canonicalEvidence: canonicalEvidence(record) };
      rejectionCode = "append_conflict";
      const outcome = await this.#journal.appendCanonical({
        transaction: context.transaction,
        prepared,
        entry,
      });
      if (outcome.status === "conflict") throw new TypeError("audit append compare-and-set conflict");
      if (outcome.status !== "appended" && outcome.status !== "exact") {
        throw new TypeError("audit append outcome is invalid");
      }
      rejectionCode = "canonical_conflict";
      if (!sameEvidence(outcome.entry, entry)) throw new TypeError("audit append did not preserve canonical evidence");
      return outcome.entry.record;
    } catch (error) {
      await this.#recordTrustedRejection(context, rejectionCode);
      throw error;
    }
  }

  #verifyExactReplay(
    context: InternalAuditContext,
    draft: ServerAuditEventDraft,
    existing: CommittedServerAuditEntry,
  ): PersistedServerAuditEvent {
    const record = parsePersisted(existing.record);
    if (!matchesContextAndDraft(record, context, draft)) {
      throw new TypeError("audit event identity conflicts with immutable evidence");
    }
    assertEventHash(record);
    if (!sameBytes(existing.canonicalEvidence, canonicalEvidence(record))) {
      throw new TypeError("stored audit evidence is not canonical");
    }
    return record;
  }

  async #recordTrustedRejection(
    context: InternalAuditContext,
    rejectionCode: ServerAuditRejectionCode,
  ): Promise<void> {
    try {
      await this.#journal.quarantineTrustedRejection({
        transaction: context.transaction,
        rejectionCode,
        rejectionDigest: trustedRejectionDigest(context, rejectionCode),
      });
    } catch {
      // This same-transaction candidate cannot change the already fail-closed append decision.
      // In particular, do not surface a diagnostic sink error in place of the original rejection.
    }
  }

  async #resolveTransitionLink(
    context: InternalAuditContext,
    chainId: string,
    occurredAt: string,
  ): Promise<string | null> {
    const purpose = signingPurposeFor(context.kind);
    const resolved = parseIncomingTransitionResolution(await this.#authority.resolveIncomingTransition({
      transaction: context.transaction,
      domain: context.domain,
      signingKeyPurpose: purpose,
      signingKeyId: context.signingKeyId,
      signingKeyVersion: context.signingKeyVersion,
      occurredAt,
    }));
    if (resolved.status === "unchanged_current_signer") return null;

    const transition = resolved.transition;
    assertEventHash(transition);
    await this.#authority.verifyCommittedRecordSignature(transition);
    if (transition.auditEventKind !== "service" || transition.eventType !== transitionAction) {
      throw new TypeError("incoming audit key transition is not a committed service transition");
    }
    const payload = transition.payloadRedacted;
    if (!("affectedSigningKeyPurpose" in payload) || !("effectiveBoundary" in payload)) {
      throw new TypeError("incoming audit key transition payload is invalid");
    }
    if (
      payload.affectedSigningKeyPurpose !== purpose
      || payload.affectedIncomingPublicKeyId !== context.signingKeyId
      || payload.affectedIncomingPublicKeyVersion !== context.signingKeyVersion
    ) {
      throw new TypeError("incoming audit signer does not match its transition");
    }
    if (!transitionVisibleTo(context.domain, transition)) {
      throw new TypeError("incoming audit transition crosses an untrusted tenant boundary");
    }
    if (Date.parse(occurredAt) <= Date.parse(payload.effectiveBoundary.notBeforeOccurredAt)) {
      throw new TypeError("incoming audit event precedes its transition boundary");
    }
    await this.#authority.assertTransitionAffectedPair(transition);
    const use = await this.#journal.inspectIncomingSignerUse({
      transaction: context.transaction,
      chainId,
      signingKeyPurpose: purpose,
      signingKeyId: context.signingKeyId,
      signingKeyVersion: context.signingKeyVersion,
    });
    if (use.hasPriorUse) {
      if (use.firstTransitionId !== transition.auditEventId) {
        throw new TypeError("incoming audit signing key has a conflicting transition link");
      }
      return null;
    }
    if (use.firstTransitionId !== null) throw new TypeError("incoming audit transition link is duplicated");
    return transition.auditEventId;
  }
}

function buildUnsignedRecord(input: {
  readonly context: InternalAuditContext;
  readonly draft: ServerAuditEventDraft;
  readonly prepared: PreparedServerAuditAppend;
  readonly signingKeyTransitionId: string | null;
}): Record<string, unknown> {
  const payloadRedacted = completedPayload(
    input.draft,
    input.prepared.chainId,
    input.prepared.auditSequence,
    input.prepared.occurredAt,
  );
  return {
    schemaVersion: SERVER_AUDIT_EVENT_SCHEMA_VERSION,
    auditEventKind: input.context.kind,
    eventType: input.draft.eventType,
    targetType: input.context.targetType,
    targetRef: input.context.targetRef,
    actorId: input.context.domain.actorId,
    chainId: input.prepared.chainId,
    auditSequence: input.prepared.auditSequence,
    previousHash: input.prepared.previousHash,
    occurredAt: input.prepared.occurredAt,
    authorizationContextHash: input.context.authorizationContextHash,
    cryptographicSignerKind: "gooddealer_audit_service",
    cryptographicSignerId: input.context.cryptographicSignerId,
    signingKeyId: input.context.signingKeyId,
    signingKeyVersion: input.context.signingKeyVersion,
    signatureTranscriptVersion: 1,
    signing_key_transition_id: input.signingKeyTransitionId,
    actorKind: input.context.kind,
    authorizationSource: input.context.authorizationSource,
    signingKeyPurpose: signingPurposeFor(input.context.kind),
    payloadRedacted,
    tenantScope: input.context.domain.tenantScope,
    accountId: input.context.domain.accountId,
    workspaceId: input.context.domain.workspaceId,
    auditEventId: input.context.auditEventId,
  };
}

function completedPayload(
  draft: ServerAuditEventDraft,
  chainId: string,
  auditSequence: number,
  occurredAt: string,
): unknown {
  if (draft.auditEventKind !== "service" || draft.eventType !== transitionAction) return draft.payloadRedacted;
  const payload = draft.payloadRedacted;
  if (!("affectedSigningKeyPurpose" in payload)) throw new TypeError("audit transition draft payload is invalid");
  if (
    payload.affectedOutgoingPublicKeyId === payload.affectedIncomingPublicKeyId
    && payload.affectedOutgoingPublicKeyVersion === payload.affectedIncomingPublicKeyVersion
  ) throw new TypeError("audit transition key pair must be distinct");
  return {
    ...payload,
    effectiveBoundary: {
      rule: "after_transition_commit",
      transitionChainId: chainId,
      transitionAuditSequence: auditSequence,
      notBeforeOccurredAt: occurredAt,
    },
  };
}

function matchesContextAndDraft(
  record: PersistedServerAuditEvent,
  context: InternalAuditContext,
  draft: ServerAuditEventDraft,
): boolean {
  if (
    record.auditEventId !== context.auditEventId
    || record.auditEventKind !== context.kind
    || record.eventType !== draft.eventType
    || record.targetType !== context.targetType
    || record.targetRef !== context.targetRef
    || record.actorId !== context.domain.actorId
    || record.authorizationContextHash !== context.authorizationContextHash
    || record.cryptographicSignerKind !== "gooddealer_audit_service"
    || record.cryptographicSignerId !== context.cryptographicSignerId
    || record.signingKeyId !== context.signingKeyId
    || record.signingKeyVersion !== context.signingKeyVersion
    || record.signatureTranscriptVersion !== 1
    || record.actorKind !== context.kind
    || record.authorizationSource !== context.authorizationSource
    || record.signingKeyPurpose !== signingPurposeFor(context.kind)
    || record.tenantScope !== context.domain.tenantScope
    || record.accountId !== context.domain.accountId
    || record.workspaceId !== context.domain.workspaceId
    || record.chainId !== chainIdFor(context.domain)
  ) return false;

  const expectedPayload = completedPayload(draft, record.chainId, record.auditSequence, record.occurredAt);
  return sameJson(record.payloadRedacted, expectedPayload);
}

function recordSignerBinding(context: InternalAuditContext, occurredAt: string): RecordSignerBinding {
  return {
    auditEventKind: context.kind,
    signingKeyPurpose: signingPurposeFor(context.kind),
    cryptographicSignerId: context.cryptographicSignerId,
    signingKeyId: context.signingKeyId,
    signingKeyVersion: context.signingKeyVersion,
    occurredAt,
  };
}

function signingPurposeFor(kind: ServerAuditKind): ServerAuditSigningPurpose {
  switch (kind) {
    case "user": return "user_audit";
    case "staff": return "staff_audit";
    case "service": return "service_audit";
  }
}

function transitionVisibleTo(domain: ServerAuditChainDomain, transition: ServiceAuditEvent): boolean {
  if (transition.tenantScope === "global") return true;
  if (transition.tenantScope === "account") return domain.accountId === transition.accountId;
  return domain.tenantScope === "workspace"
    && domain.accountId === transition.accountId
    && domain.workspaceId === transition.workspaceId;
}

function chainIdFor(domain: ServerAuditChainDomain): string {
  return digest(encodeServerAuditChainDomain(domain));
}

/**
 * Quarantine receives only this bounded digest and its fixed code. It deliberately excludes the
 * raw draft, target, signer/key identifiers, and any potential secret-bearing candidate value.
 */
function trustedRejectionDigest(
  context: InternalAuditContext,
  rejectionCode: ServerAuditRejectionCode,
): string {
  return createHash("sha256")
    .update("GOODDEALER-SERVER-AUDIT-QUARANTINE-V1\u0000", "utf8")
    .update(context.kind, "utf8")
    .update("\u0000", "utf8")
    .update(context.auditEventId, "utf8")
    .update("\u0000", "utf8")
    .update(chainIdFor(context.domain), "utf8")
    .update("\u0000", "utf8")
    .update(rejectionCode, "utf8")
    .digest("base64url");
}

function canonicalEvidence(record: PersistedServerAuditEvent): Uint8Array {
  const transcript = encodeAuditSignatureTranscript(record);
  const signature = Buffer.from(record.serverSignature, "base64url");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(signature.length, 0);
  return Buffer.concat([Buffer.from(transcript), length, signature]);
}

function assertEventHash(record: PersistedServerAuditEvent): void {
  if (record.eventHash !== digest(encodeAuditHashInput({ ...record, serverSignature: placeholderSignature }))) {
    throw new TypeError("stored audit event hash is invalid");
  }
}

function encodeAuditHashInput(value: unknown): Uint8Array {
  try {
    return encodeServerAuditEventHashInput(value);
  } catch {
    throw new TypeError("audit record is invalid");
  }
}

function encodeAuditSignatureTranscript(value: unknown): Uint8Array {
  try {
    return encodeServerAuditEventSignatureTranscript(value);
  } catch {
    throw new TypeError("audit record is invalid");
  }
}

function parseClosedDraft(value: unknown): ServerAuditEventDraft {
  if (!isSafeData(value) || containsSensitiveValue(value)) throw new TypeError("audit draft is invalid");
  const result = serverAuditEventDraftSchema.safeParse(value);
  if (!result.success) throw new TypeError("audit draft is invalid");
  return result.data;
}

function parsePersisted(value: unknown): PersistedServerAuditEvent {
  if (!isSafeData(value)) throw new TypeError("audit record is invalid");
  const result = persistedServerAuditEventSchema.safeParse(value);
  if (!result.success) throw new TypeError("audit record is invalid");
  return result.data;
}

function parseIncomingTransitionResolution(value: unknown): IncomingTransitionResolution {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError();
    const statusDescriptor = Object.getOwnPropertyDescriptor(value, "status");
    if (
      statusDescriptor === undefined
      || !("value" in statusDescriptor)
      || statusDescriptor.enumerable !== true
      || typeof statusDescriptor.value !== "string"
    ) throw new TypeError();
    if (statusDescriptor.value === "unchanged_current_signer") {
      exactOwnDataProperties(value, ["status"]);
      return { status: "unchanged_current_signer" };
    }
    if (statusDescriptor.value === "required_transition") {
      const fields = exactOwnDataProperties(value, ["status", "transition"]);
      const transition = parsePersisted(fields.transition);
      if (transition.auditEventKind !== "service") throw new TypeError();
      return { status: "required_transition", transition };
    }
  } catch {
    throw new TypeError("incoming audit transition resolution is invalid");
  }
  throw new TypeError("incoming audit transition resolution is invalid");
}

function parseTransactionToken(value: unknown): object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("audit transaction is unresolved");
  }
  return value;
}

function parseWorkspaceScope(value: unknown): AuditDomainScope {
  const fields = exactOwnDataProperties(value, ["accountId", "workspaceId"]);
  return {
    tenantScope: "workspace",
    accountId: parseIdentifier(fields.accountId, "account id"),
    workspaceId: parseIdentifier(fields.workspaceId, "workspace id"),
  };
}

/**
 * User contexts have no future cross-account authority. Scope-shaped targets are therefore
 * bound here, before an opaque context exists; non-scope domain references stay owned by the
 * verified user-session source rather than being over-constrained by this audit substrate.
 */
function assertUserTargetScope(scope: AuditDomainScope, targetType: string, targetRef: string): void {
  if (targetType === "account" && targetRef !== scope.accountId) {
    throw new TypeError("user audit account target is outside its bound scope");
  }
  if (targetType === "workspace" && (scope.tenantScope !== "workspace" || targetRef !== scope.workspaceId)) {
    throw new TypeError("user audit workspace target is outside its bound scope");
  }
}

function parseContextIssue(value: unknown, includeAuthorizationSource: boolean): ParsedContextIssue {
  const expected = includeAuthorizationSource
    ? [
      "transaction", "auditEventId", "actorId", "targetType", "targetRef", "authorizationContextHash",
      "cryptographicSignerId", "signingKeyId", "signingKeyVersion", "authorizationSource",
    ]
    : [
      "transaction", "auditEventId", "actorId", "targetType", "targetRef", "authorizationContextHash",
      "cryptographicSignerId", "signingKeyId", "signingKeyVersion",
    ];
  const fields = exactOwnDataProperties(value, expected);
  const authorizationSource = includeAuthorizationSource
    ? parseAuthorizationSource(fields.authorizationSource)
    : undefined;
  return {
    transaction: parseTransactionToken(fields.transaction),
    auditEventId: parseIdentifier(fields.auditEventId, "audit event id"),
    actorId: parseIdentifier(fields.actorId, "audit actor id"),
    targetType: parseIdentifier(fields.targetType, "audit target type"),
    targetRef: parseIdentifier(fields.targetRef, "audit target reference"),
    authorizationContextHash: parseDigest(fields.authorizationContextHash, "authorization context hash"),
    cryptographicSignerId: parseIdentifier(fields.cryptographicSignerId, "audit signer id"),
    signingKeyId: parseIdentifier(fields.signingKeyId, "audit signing key id"),
    signingKeyVersion: parsePositiveInteger(fields.signingKeyVersion, "audit signing key version"),
    ...(authorizationSource === undefined ? {} : { authorizationSource }),
  };
}

function parseDomain(value: unknown): ServerAuditChainDomain {
  try {
    // The public protocol encoder is also the strict domain parser; no local duplicate schema is
    // kept in Cloud.
    encodeServerAuditChainDomain(value);
    return value as ServerAuditChainDomain;
  } catch {
    throw new TypeError("audit chain domain is invalid");
  }
}

function parseAuthorizationSource(value: unknown): InternalAuditContext["authorizationSource"] {
  if (
    value !== "user_session"
    && value !== "admin_read_authorization"
    && value !== "admin_action_authorization"
    && value !== "service_identity"
    && value !== "tenant_job_context"
  ) throw new TypeError("audit authorization source is unresolved");
  return value;
}

function parseIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) throw new TypeError(`${label} is unresolved`);
  return value;
}

function parseDigest(value: unknown, label: string): string {
  if (typeof value !== "string" || !digestPattern.test(value)) throw new TypeError(`${label} is unresolved`);
  return value;
}

function parsePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 1) throw new TypeError(`${label} is unresolved`);
  return value;
}

function isCanonicalTimestamp(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/u.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value.replace(/Z$/u, ".000Z");
}

function exactOwnDataProperties(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("audit context is malformed");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("audit context is malformed");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string") || !sameStringSet(keys as string[], expected)) {
    throw new TypeError("audit context is malformed");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError("audit context is malformed");
    }
    result[key] = descriptor.value;
  }
  return result;
}

function isSafeData(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((entry) => isSafeData(entry, seen));
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return keys.every((key) => {
    const descriptor = descriptors[key as string];
    return descriptor !== undefined
      && "value" in descriptor
      && descriptor.enumerable === true
      && isSafeData(descriptor.value, seen);
  });
}

function containsSensitiveValue(value: unknown): boolean {
  const markers = [
    "-----begin", "private key", "bearer ", "authorization:", "cookie=", "api_key",
    "access_token", "refresh_token", "kms://", "hsm://", "client_secret", "recovery secret",
  ];
  const sensitiveKeys = ["privatekey", "password", "secret", "token", "cookie", "authorizationheader", "kms", "hsm"];
  const visit = (candidate: unknown): boolean => {
    if (typeof candidate === "string") {
      const normalized = candidate.toLowerCase();
      return markers.some((marker) => normalized.includes(marker));
    }
    if (candidate === null || typeof candidate !== "object") return false;
    return Object.entries(candidate).some(([key, nested]) =>
      sensitiveKeys.some((marker) => key.toLowerCase().replace(/[_-]/gu, "").includes(marker)) || visit(nested));
  };
  return visit(value);
}

function sameDomainScope(left: AuditDomainScope, right: AuditDomainScope): boolean {
  return left.tenantScope === right.tenantScope
    && left.accountId === right.accountId
    && left.workspaceId === right.workspaceId;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("base64url");
}

function sameEvidence(left: CommittedServerAuditEntry, right: CommittedServerAuditEntry): boolean {
  return sameBytes(left.canonicalEvidence, right.canonicalEvidence) && sameJson(left.record, right.record);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
