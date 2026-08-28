import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  encodeServerAuditChainDomain,
  encodeServerAuditEventHashInput,
  encodeServerAuditEventSignatureTranscript,
  persistedServerAuditEventSchema,
  type PersistedServerAuditEvent,
  type ServerAuditChainDomain,
  type ServiceAuditEvent,
} from "@gooddealer/protocol/audit";

import {
  ServerAuditContextIssuer,
  ServerAuditRuntime,
  type AuditChainHead,
  type CommittedServerAuditEntry,
  type ServerAuditAppendJournal,
  type ServerAuditSigningAuthority,
} from "../src/modules/audit/server-audit";
import { PostgresServerAuditJournal } from "../src/modules/audit/postgres-server-audit-journal";

const genesisHash = digest("GOODDEALER-SERVER-AUDIT-CHAIN-GENESIS-V1");
const accountA = "account-a";
const accountB = "account-b";
const workspaceA = "workspace-a";
const workspaceB = "workspace-b";

class RecordingJournal implements ServerAuditAppendJournal {
  readonly entries = new Map<string, CommittedServerAuditEntry>();
  readonly heads = new Map<string, AuditChainHead>();
  readonly quarantines: {
    readonly transaction: object;
    readonly rejectionCode: Parameters<ServerAuditAppendJournal["quarantineTrustedRejection"]>[0]["rejectionCode"];
    readonly rejectionDigest: string;
  }[] = [];
  appendCalls = 0;
  lastTransaction: object | null = null;
  forceConflict = false;
  forcedIncomingUse: { readonly hasPriorUse: boolean; readonly firstTransitionId: string | null } | null = null;

  constructor(private readonly now: () => string) {}

  async readCommittedByAuditEventId(_transaction: object, auditEventId: string) {
    return this.entries.get(auditEventId) ?? null;
  }

  async prepareAppend(input: Parameters<ServerAuditAppendJournal["prepareAppend"]>[0]) {
    const head = this.heads.get(input.chainId) ?? null;
    return {
      chainId: input.chainId,
      auditSequence: (head?.auditSequence ?? 0) + 1,
      previousHash: head?.eventHash ?? genesisHash,
      occurredAt: this.now(),
    };
  }

  async appendCanonical(input: Parameters<ServerAuditAppendJournal["appendCanonical"]>[0]) {
    this.appendCalls += 1;
    this.lastTransaction = input.transaction;
    if (this.forceConflict) return { status: "conflict" as const };
    const existing = this.entries.get(input.entry.record.auditEventId);
    if (existing !== undefined) {
      return sameEvidence(existing, input.entry)
        ? { status: "exact" as const, entry: existing }
        : { status: "conflict" as const };
    }
    const head = this.heads.get(input.entry.record.chainId) ?? null;
    if (
      input.prepared.chainId !== input.entry.record.chainId
      || input.prepared.auditSequence !== (head?.auditSequence ?? 0) + 1
      || input.prepared.previousHash !== (head?.eventHash ?? genesisHash)
      || input.prepared.occurredAt !== input.entry.record.occurredAt
    ) return { status: "conflict" as const };
    if (
      input.entry.record.auditSequence !== (head?.auditSequence ?? 0) + 1
      || input.entry.record.previousHash !== (head?.eventHash ?? genesisHash)
    ) return { status: "conflict" as const };
    this.entries.set(input.entry.record.auditEventId, input.entry);
    this.heads.set(input.entry.record.chainId, {
      chainId: input.entry.record.chainId,
      auditSequence: input.entry.record.auditSequence,
      eventHash: input.entry.record.eventHash,
    });
    return { status: "appended" as const, entry: input.entry };
  }

  async inspectIncomingSignerUse(input: Parameters<ServerAuditAppendJournal["inspectIncomingSignerUse"]>[0]) {
    if (this.forcedIncomingUse !== null) return this.forcedIncomingUse;
    const matching = [...this.entries.values()]
      .map((entry) => entry.record)
      .filter((record) =>
        record.chainId === input.chainId
        && record.signingKeyPurpose === input.signingKeyPurpose
        && record.signingKeyId === input.signingKeyId
        && record.signingKeyVersion === input.signingKeyVersion,
      )
      .sort((left, right) => left.auditSequence - right.auditSequence);
    return {
      hasPriorUse: matching.length > 0,
      firstTransitionId: matching.find((record) => record.signing_key_transition_id !== null)?.signing_key_transition_id ?? null,
    };
  }

  async quarantineTrustedRejection(input: Parameters<ServerAuditAppendJournal["quarantineTrustedRejection"]>[0]) {
    this.quarantines.push({ ...input });
  }

  seed(record: PersistedServerAuditEvent): void {
    const entry = evidenceEntry(record);
    this.entries.set(record.auditEventId, entry);
    this.heads.set(record.chainId, {
      chainId: record.chainId,
      auditSequence: record.auditSequence,
      eventHash: record.eventHash,
    });
  }
}

class RecordingAuthority implements ServerAuditSigningAuthority {
  resolution: unknown = { status: "unchanged_current_signer" };
  resolveError: Error | null = null;
  pairError: Error | null = null;
  recordSignerError: Error | null = null;
  committedSignatureError: Error | null = null;
  recordSignerCalls = 0;
  transitionSignatureChecks = 0;
  transitionPairChecks = 0;
  transitionResolveCalls = 0;

  async assertCurrentRecordSigner(): Promise<void> {
    this.recordSignerCalls += 1;
    if (this.recordSignerError !== null) throw this.recordSignerError;
  }

  async verifyCommittedRecordSignature(): Promise<void> {
    this.transitionSignatureChecks += 1;
    if (this.committedSignatureError !== null) throw this.committedSignatureError;
  }

  async assertTransitionAffectedPair(): Promise<void> {
    this.transitionPairChecks += 1;
    if (this.pairError !== null) throw this.pairError;
  }

  async resolveIncomingTransition(): Promise<unknown> {
    this.transitionResolveCalls += 1;
    if (this.resolveError !== null) throw this.resolveError;
    return this.resolution;
  }
}

class DeterministicTestSigner {
  calls = 0;

  async sign(input: { readonly transcript: Uint8Array }): Promise<string> {
    this.calls += 1;
    return digest(input.transcript);
  }
}

function setup(now = "2026-08-23T00:00:20Z") {
  let instant = now;
  const issuer = new ServerAuditContextIssuer();
  const journal = new RecordingJournal(() => instant);
  const authority = new RecordingAuthority();
  const signer = new DeterministicTestSigner();
  const txA = {};
  const txB = {};
  issuer.bindWorkspaceTransaction(txA, { accountId: accountA, workspaceId: workspaceA });
  issuer.bindWorkspaceTransaction(txB, { accountId: accountB, workspaceId: workspaceB });
  const runtime = new ServerAuditRuntime({ contexts: issuer, journal, authority, signer });
  return {
    issuer,
    journal,
    authority,
    signer,
    runtime,
    txA,
    txB,
    setNow: (value: string) => { instant = value; },
  };
}

function issueUser(
  issuer: ServerAuditContextIssuer,
  transaction: object,
  auditEventId: string,
  signingKeyId = "user-key-old",
  targetRef = accountA,
  targetType = "account",
) {
  return issuer.issueUser({
    transaction,
    auditEventId,
    actorId: "user-a",
    targetType,
    targetRef,
    authorizationContextHash: digest("user-authorization"),
    cryptographicSignerId: "audit-service",
    signingKeyId,
    signingKeyVersion: 1,
  });
}

function issueStaff(
  issuer: ServerAuditContextIssuer,
  transaction: object,
  auditEventId: string,
  signingKeyId = "staff-key-old",
) {
  return issuer.issueStaff({
    transaction,
    auditEventId,
    actorId: "staff-a",
    targetType: "account",
    targetRef: accountA,
    authorizationContextHash: digest("staff-authorization"),
    cryptographicSignerId: "audit-service",
    signingKeyId,
    signingKeyVersion: 1,
    authorizationSource: "admin_action_authorization",
  });
}

function issueService(
  issuer: ServerAuditContextIssuer,
  transaction: object,
  auditEventId: string,
  signingKeyId = "service-key-old",
) {
  return issuer.issueService({
    transaction,
    auditEventId,
    actorId: "audit-service",
    targetType: "account",
    targetRef: accountA,
    authorizationContextHash: digest("service-authorization"),
    cryptographicSignerId: "audit-service",
    signingKeyId,
    signingKeyVersion: 1,
    authorizationSource: "service_identity",
  });
}

function userDraft(targetRef = accountA, targetType = "account") {
  return {
    schemaVersion: 1,
    auditEventKind: "user",
    eventType: "account_security",
    targetType,
    targetRef,
    payloadRedacted: {
      action: "account_security",
      outcome: "accepted",
      reason: "password_changed",
      securityEpoch: 2,
      beforeDigest: digest("before"),
      afterDigest: digest("after"),
      correlationRef: "correlation-a",
    },
  } as const;
}

function userSessionDraft() {
  return {
    schemaVersion: 1,
    auditEventKind: "user",
    eventType: "account_session",
    targetType: "account",
    targetRef: accountA,
    payloadRedacted: {
      action: "account_session",
      outcome: "started",
      reason: "user_requested",
      sessionAuditRef: null,
      securityEpoch: null,
      correlationRef: null,
    },
  } as const;
}

function staffDraft() {
  return {
    schemaVersion: 1,
    auditEventKind: "staff",
    eventType: "security_incident_staff_action",
    targetType: "account",
    targetRef: accountA,
    payloadRedacted: {
      action: "security_incident_staff_action",
      outcome: "acknowledged",
      reason: "authorized",
      incidentRef: "incident-a",
      authorizationDigest: digest("staff-action"),
      beforeDigest: null,
      afterDigest: digest("staff-after"),
    },
  } as const;
}

function serviceDraft() {
  return {
    schemaVersion: 1,
    auditEventKind: "service",
    eventType: "identity_defense",
    targetType: "account",
    targetRef: accountA,
    payloadRedacted: {
      action: "identity_defense",
      outcome: "contained",
      reason: "credential_risk",
      securityEventRef: "security-event-a",
      evidenceDigest: digest("service-evidence"),
    },
  } as const;
}

function transitionDraft(
  affectedSigningKeyPurpose: "user_audit" | "staff_audit" | "service_audit",
  affectedOutgoingPublicKeyId: string,
  affectedIncomingPublicKeyId: string,
) {
  return {
    schemaVersion: 1,
    auditEventKind: "service",
    eventType: "audit_signing_key_transition",
    targetType: "account",
    targetRef: accountA,
    payloadRedacted: {
      affectedSigningKeyPurpose,
      affectedOutgoingPublicKeyId,
      affectedOutgoingPublicKeyVersion: 1,
      affectedIncomingPublicKeyId,
      affectedIncomingPublicKeyVersion: 1,
      custodyApprovalDigest: digest("custody-approval"),
    },
  } as const;
}

function transitionRecord(input: {
  readonly auditEventId: string;
  readonly affectedPurpose: "user_audit" | "staff_audit" | "service_audit";
  readonly affectedOutgoingKeyId: string;
  readonly affectedIncomingKeyId: string;
  readonly signingKeyId: string;
  readonly auditSequence?: number;
  readonly previousHash?: string;
  readonly occurredAt?: string;
}): ServiceAuditEvent {
  const domain = serviceDomain();
  const chainId = digest(encodeServerAuditChainDomain(domain));
  const auditSequence = input.auditSequence ?? 1;
  const occurredAt = input.occurredAt ?? "2026-08-23T00:00:10Z";
  const unsigned = {
    schemaVersion: 1,
    auditEventId: input.auditEventId,
    auditEventKind: "service",
    eventType: "audit_signing_key_transition",
    targetType: "account",
    targetRef: accountA,
    actorId: "audit-service",
    chainId,
    auditSequence,
    previousHash: input.previousHash ?? genesisHash,
    occurredAt,
    authorizationContextHash: digest("transition-authorization"),
    cryptographicSignerKind: "gooddealer_audit_service",
    cryptographicSignerId: "audit-service",
    signingKeyId: input.signingKeyId,
    signingKeyVersion: 1,
    signatureTranscriptVersion: 1,
    signing_key_transition_id: null,
    actorKind: "service",
    authorizationSource: "service_identity",
    signingKeyPurpose: "service_audit",
    payloadRedacted: {
      affectedSigningKeyPurpose: input.affectedPurpose,
      affectedOutgoingPublicKeyId: input.affectedOutgoingKeyId,
      affectedOutgoingPublicKeyVersion: 1,
      affectedIncomingPublicKeyId: input.affectedIncomingKeyId,
      affectedIncomingPublicKeyVersion: 1,
      effectiveBoundary: {
        rule: "after_transition_commit",
        transitionChainId: chainId,
        transitionAuditSequence: auditSequence,
        notBeforeOccurredAt: occurredAt,
      },
      custodyApprovalDigest: digest("transition-custody"),
    },
    tenantScope: "workspace",
    accountId: accountA,
    workspaceId: workspaceA,
  } as const;
  const eventHash = digest(encodeServerAuditEventHashInput({
    ...unsigned,
    eventHash: genesisHash,
    serverSignature: "AA",
  }));
  const signatureInput = { ...unsigned, eventHash, serverSignature: "AA" };
  return persistedServerAuditEventSchema.parse({
    ...signatureInput,
    serverSignature: digest(encodeServerAuditEventSignatureTranscript(signatureInput)),
  }) as ServiceAuditEvent;
}

describe("server audit trusted contexts", () => {
  it("rejects forged, copied, reused, mismatched, unbound, and cross-tenant contexts before append", async () => {
    const { issuer, runtime, journal, signer, txA, txB } = setup();
    const valid = issueUser(issuer, txA, "audit-context-valid");
    const copied = { ...(valid as object) };
    const staff = issueStaff(issuer, txA, "audit-context-staff");
    await expect(runtime.user.append({}, userDraft())).rejects.toThrow("untrusted");
    await expect(runtime.user.append(
      { targetType: "account", targetRef: accountB },
      userDraft(accountB),
    )).rejects.toThrow("untrusted");
    await expect(runtime.user.append(copied, userDraft())).rejects.toThrow("untrusted");
    await expect(runtime.user.append(staff, userDraft())).rejects.toThrow("untrusted");
    expect(signer.calls).toBe(0);
    expect(journal.appendCalls).toBe(0);
    expect(journal.quarantines).toHaveLength(0);

    const accepted = await runtime.user.append(valid, userDraft());
    expect(accepted.auditEventKind).toBe("user");
    expect(journal.lastTransaction).toBe(txA);
    await expect(runtime.user.append(valid, userDraft())).rejects.toThrow("untrusted");

    expect(() => issuer.bindWorkspaceTransaction(txA, { accountId: accountB, workspaceId: workspaceB }))
      .toThrow("cannot be rebound");
    expect(() => issueUser(issuer, {}, "audit-unbound")).toThrow("transaction is untrusted");
    expect(() => issuer.issueUser({
      transaction: txA,
      auditEventId: "audit-forged-time-context",
      actorId: "user-a",
      targetType: "account",
      targetRef: accountA,
      authorizationContextHash: digest("user-authorization"),
      cryptographicSignerId: "audit-service",
      signingKeyId: "user-key-old",
      signingKeyVersion: 1,
      occurredAt: "2000-01-01T00:00:00Z",
    })).toThrow("context is malformed");
    await expect(runtime.user.append(
      issueUser(issuer, txA, "audit-forged-time-draft"),
      { ...userDraft(), occurredAt: "2000-01-01T00:00:00Z" },
    )).rejects.toThrow("audit draft is invalid");
    const accountBContext = issueUser(issuer, txB, "audit-tenant-b", "user-key-b", accountB);
    const accountBRecord = await runtime.user.append(accountBContext, userDraft(accountB));
    expect(accountBRecord.accountId).toBe(accountB);
    expect(accountBRecord.workspaceId).toBe(workspaceB);
    expect(journal.entries).toHaveLength(2);
  });

  it("binds User account and workspace targets to the scope before an opaque context exists", async () => {
    const { issuer, runtime, journal, signer, txA } = setup();
    const accountRecord = await runtime.user.append(
      issueUser(issuer, txA, "audit-user-target-account", "user-key-account", accountA),
      userDraft(accountA),
    );
    const workspaceRecord = await runtime.user.append(
      issueUser(issuer, txA, "audit-user-target-workspace", "user-key-workspace", workspaceA, "workspace"),
      userDraft(workspaceA, "workspace"),
    );
    expect(accountRecord.targetRef).toBe(accountA);
    expect(workspaceRecord.targetRef).toBe(workspaceA);

    expect(() => issueUser(issuer, txA, "audit-user-target-account-b", "user-key-forged", accountB))
      .toThrow("outside its bound scope");
    expect(() => issueUser(issuer, txA, "audit-user-target-workspace-b", "user-key-forged", workspaceB, "workspace"))
      .toThrow("outside its bound scope");
    const accountTransaction = {};
    issuer.bindAccountTransaction(accountTransaction, accountA);
    expect(() => issueUser(
      issuer,
      accountTransaction,
      "audit-account-scope-workspace-target",
      "user-key-forged",
      workspaceA,
      "workspace",
    )).toThrow("outside its bound scope");

    // The rejected target values never become contexts, so neither append nor same-transaction
    // quarantine can observe them.
    expect(journal.appendCalls).toBe(2);
    expect(journal.quarantines).toHaveLength(0);
    expect(signer.calls).toBe(2);
  });

  it("keeps Security as a source-restricted emission and rejects foreign domains and secrets", async () => {
    const { issuer, runtime, journal, signer, txA } = setup();
    const secretCanary = "audit-secret-canary";
    const emitted = await runtime.security.emitAccountSecurity(
      issueUser(issuer, txA, "audit-security-emission"),
      userDraft(),
    );
    expect(emitted.auditEventKind).toBe("user");
    expect(JSON.stringify(emitted)).not.toContain("securityAuditEvent");
    expect(JSON.stringify(emitted)).not.toContain(secretCanary);

    await expect(runtime.security.emitAccountSecurity(
      issueUser(issuer, txA, "audit-security-wrong-action"),
      userSessionDraft(),
    )).rejects.toThrow("not permitted");
    await expect(runtime.user.append(
      issueUser(issuer, txA, "audit-device-foreign"),
      { ...userDraft(), auditEventKind: "device", sourceDeviceId: "device-a" },
    )).rejects.toThrow("audit draft is invalid");
    await expect(runtime.user.append(
      issueUser(issuer, txA, "audit-sunset-foreign"),
      { ...userDraft(), auditEventKind: "sunset" },
    )).rejects.toThrow("audit draft is invalid");
    await expect(runtime.user.append(
      issueUser(issuer, txA, "audit-secret-rejection"),
      { ...userDraft(), payloadRedacted: { ...userDraft().payloadRedacted, secretCanary } },
    )).rejects.toThrow("audit draft is invalid");
    expect(JSON.stringify([...journal.entries.values()])).not.toContain(secretCanary);
    expect(signer.calls).toBe(1);
  });
});

describe("server audit immutable append", () => {
  it("accepts only an exact retry and leaves the head unchanged on conflict or CAS loss", async () => {
    const { issuer, runtime, journal, signer, txA } = setup();
    const first = await runtime.user.append(issueUser(issuer, txA, "audit-retry"), userDraft());
    const retry = await runtime.user.append(issueUser(issuer, txA, "audit-retry"), userDraft());
    expect(retry).toEqual(first);
    expect(signer.calls).toBe(1);
    expect(journal.appendCalls).toBe(1);

    const beforeConflict = journal.heads.get(first.chainId);
    await expect(runtime.user.append(
      issueUser(issuer, txA, "audit-retry"),
      { ...userDraft(), payloadRedacted: { ...userDraft().payloadRedacted, afterDigest: digest("conflict") } },
    )).rejects.toThrow("conflicts with immutable evidence");
    expect(journal.heads.get(first.chainId)).toEqual(beforeConflict);

    journal.forceConflict = true;
    await expect(runtime.user.append(issueUser(issuer, txA, "audit-cas-loss"), userDraft()))
      .rejects.toThrow("compare-and-set conflict");
    expect(journal.heads.get(first.chainId)).toEqual(beforeConflict);
    expect([...journal.entries.keys()]).not.toContain("audit-cas-loss");
  });

  it("defaults to the denying production signer and performs no journal append", async () => {
    const issuer = new ServerAuditContextIssuer();
    const journal = new RecordingJournal(() => "2026-08-23T00:00:20Z");
    const authority = new RecordingAuthority();
    const transaction = {};
    issuer.bindWorkspaceTransaction(transaction, { accountId: accountA, workspaceId: workspaceA });
    const runtime = new ServerAuditRuntime({ contexts: issuer, journal, authority });
    await expect(runtime.user.append(issueUser(issuer, transaction, "audit-denied"), userDraft()))
      .rejects.toThrow("unavailable pending approved custodian authority");
    expect(journal.appendCalls).toBe(0);
  });
});

describe("server audit trusted-rejection quarantine", () => {
  it("records only same-transaction digest candidates after trusted schema, signer, transition, and CAS rejections", async () => {
    const candidateCanary = "raw-draft-candidate-canary";
    const secretCanary = "audit-secret-canary";

    const schema = setup();
    await expect(schema.runtime.user.append(
      issueUser(schema.issuer, schema.txA, "audit-quarantine-schema"),
      {
        ...userDraft(),
        payloadRedacted: { ...userDraft().payloadRedacted, rawCandidate: candidateCanary, secretCanary },
      },
    )).rejects.toThrow("audit draft is invalid");
    expect(schema.journal.appendCalls).toBe(0);
    expect(schema.journal.quarantines).toMatchObject([{ rejectionCode: "schema_invalid" }]);
    expect(schema.journal.quarantines[0]?.transaction).toBe(schema.txA);

    const signer = setup();
    signer.authority.recordSignerError = new TypeError("current signer is revoked");
    await expect(signer.runtime.user.append(
      issueUser(signer.issuer, signer.txA, "audit-quarantine-signer"),
      userDraft(),
    )).rejects.toThrow("current signer is revoked");
    expect(signer.journal.appendCalls).toBe(0);
    expect(signer.journal.quarantines).toMatchObject([{ rejectionCode: "signer_invalid" }]);
    expect(signer.journal.quarantines[0]?.transaction).toBe(signer.txA);

    const transition = setup();
    transition.authority.resolution = null;
    await expect(transition.runtime.user.append(
      issueUser(transition.issuer, transition.txA, "audit-quarantine-transition", "user-key-incoming"),
      userDraft(),
    )).rejects.toThrow("transition resolution is invalid");
    expect(transition.journal.appendCalls).toBe(0);
    expect(transition.journal.quarantines).toMatchObject([{ rejectionCode: "transition_invalid" }]);
    expect(transition.journal.quarantines[0]?.transaction).toBe(transition.txA);

    const cas = setup();
    cas.journal.forceConflict = true;
    await expect(cas.runtime.user.append(
      issueUser(cas.issuer, cas.txA, "audit-quarantine-cas"),
      userDraft(),
    )).rejects.toThrow("compare-and-set conflict");
    expect(cas.journal.appendCalls).toBe(1);
    expect(cas.journal.entries).toHaveLength(0);
    expect(cas.journal.quarantines).toMatchObject([{ rejectionCode: "append_conflict" }]);
    expect(cas.journal.quarantines[0]?.transaction).toBe(cas.txA);

    const metadata = JSON.stringify([
      ...schema.journal.quarantines,
      ...signer.journal.quarantines,
      ...transition.journal.quarantines,
      ...cas.journal.quarantines,
    ]);
    expect(metadata).not.toContain(candidateCanary);
    expect(metadata).not.toContain(secretCanary);
    expect(metadata).not.toContain("user-key-incoming");
    expect(metadata).not.toContain("audit-quarantine-schema");
    for (const quarantine of [
      ...schema.journal.quarantines,
      ...signer.journal.quarantines,
      ...transition.journal.quarantines,
      ...cas.journal.quarantines,
    ]) {
      expect(quarantine.rejectionDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    }
  });

  it("uses the catalog-integrated M013 quarantine routine through the supplied tenant transaction", async () => {
    const calls: { readonly text: string; readonly values: readonly unknown[] | undefined }[] = [];
    const transaction = {
      scope: { accountId: accountA, workspaceId: workspaceA },
      query: async (text: string, values?: readonly unknown[]) => {
        calls.push({ text, values });
        return { rows: [{ quarantined: true }] };
      },
    };
    const journal = new PostgresServerAuditJournal();
    const rejectionDigest = digest("candidate-metadata-is-never-raw");
    await journal.quarantineTrustedRejection({
      transaction,
      rejectionCode: "schema_invalid",
      rejectionDigest,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("SELECT public.audit_quarantine_server_entry($1::bytea, $2::text)");
    expect(calls[0]?.text).not.toMatch(/INSERT\s+INTO\s+public\.server_audit_quarantines/iu);
    expect(calls[0]?.values?.[0]).toEqual(Buffer.from(rejectionDigest, "base64url"));
    expect(calls[0]?.values?.[1]).toBe("schema_invalid");
  });
});

describe("server audit signing-key transitions", () => {
  it("keeps User, Staff, and Service chains continuous while linking their first incoming keys", async () => {
    for (const scenario of [
      { kind: "user", purpose: "user_audit", oldKey: "user-key-old", incomingKey: "user-key-new" },
      { kind: "staff", purpose: "staff_audit", oldKey: "staff-key-old", incomingKey: "staff-key-new" },
      { kind: "service", purpose: "service_audit", oldKey: "service-key-old", incomingKey: "service-key-new" },
    ] as const) {
      const { issuer, runtime, journal, authority, txA, setNow } = setup("2026-08-23T00:00:00Z");
      const prior = scenario.kind === "user"
        ? await runtime.user.append(issueUser(issuer, txA, `audit-${scenario.kind}-old`, scenario.oldKey), userDraft())
        : scenario.kind === "staff"
        ? await runtime.staff.append(issueStaff(issuer, txA, `audit-${scenario.kind}-old`, scenario.oldKey), staffDraft())
        : await runtime.service.append(issueService(issuer, txA, `audit-${scenario.kind}-old`, scenario.oldKey), serviceDraft());
      const transition = transitionRecord({
        auditEventId: `transition-${scenario.kind}`,
        affectedPurpose: scenario.purpose,
        affectedOutgoingKeyId: scenario.oldKey,
        affectedIncomingKeyId: scenario.incomingKey,
        signingKeyId: scenario.purpose === "service_audit" ? scenario.oldKey : "service-key-rotation",
        ...(scenario.kind === "service" ? { auditSequence: 2, previousHash: prior.eventHash } : {}),
      });
      if (scenario.kind === "service") journal.seed(transition);
      authority.resolution = { status: "required_transition", transition };
      setNow("2026-08-23T00:00:11Z");
      const incoming = scenario.kind === "user"
        ? await runtime.user.append(issueUser(issuer, txA, `audit-${scenario.kind}-incoming`, scenario.incomingKey), userDraft())
        : scenario.kind === "staff"
        ? await runtime.staff.append(issueStaff(issuer, txA, `audit-${scenario.kind}-incoming`, scenario.incomingKey), staffDraft())
        : await runtime.service.append(issueService(issuer, txA, `audit-${scenario.kind}-incoming`, scenario.incomingKey), serviceDraft());
      expect(incoming.signing_key_transition_id).toBe(transition.auditEventId);
      expect(incoming.previousHash).toBe(scenario.kind === "service" ? transition.eventHash : prior.eventHash);
      expect(incoming.auditSequence).toBe(scenario.kind === "service" ? 3 : 2);
      expect(authority.transitionSignatureChecks).toBeGreaterThan(0);
      expect(authority.transitionPairChecks).toBeGreaterThan(0);
    }
  });

  it("fails closed on null, malformed, unknown, or ambiguous incoming-transition resolutions", async () => {
    const valid = transitionRecord({
      auditEventId: "transition-resolution-shape",
      affectedPurpose: "user_audit",
      affectedOutgoingKeyId: "user-key-old",
      affectedIncomingKeyId: "user-key-new",
      signingKeyId: "service-key-rotation",
    });
    const invalidResolutions: readonly { readonly name: string; readonly value: unknown }[] = [
      { name: "null", value: null },
      { name: "malformed", value: { status: "required_transition" } },
      { name: "unknown-status", value: { status: "unknown" } },
      { name: "unknown-field", value: { status: "required_transition", transition: valid, extra: true } },
      { name: "ambiguous", value: { status: "unchanged_current_signer", transition: valid } },
    ];
    for (const invalid of invalidResolutions) {
      const { issuer, runtime, journal, authority, signer, txA } = setup();
      authority.resolution = invalid.value;
      await expect(runtime.user.append(
        issueUser(issuer, txA, `audit-invalid-transition-resolution-${invalid.name}`, "user-key-new"),
        userDraft(),
      )).rejects.toThrow("transition resolution is invalid");
      expect(signer.calls).toBe(0);
      expect(journal.appendCalls).toBe(0);
      expect(journal.entries).toHaveLength(0);
      expect(journal.quarantines).toMatchObject([{ rejectionCode: "transition_invalid" }]);
    }
  });

  it("requires required_transition to contain an exact signed Service transition record", async () => {
    const { issuer, runtime, journal, authority, signer, txA } = setup();
    const ordinaryServiceRecord = await runtime.service.append(
      issueService(issuer, txA, "audit-ordinary-service-record"),
      serviceDraft(),
    );
    authority.resolution = { status: "required_transition", transition: ordinaryServiceRecord };
    await expect(runtime.user.append(
      issueUser(issuer, txA, "audit-nontransition-resolution", "user-key-new"),
      userDraft(),
    )).rejects.toThrow("not a committed service transition");
    expect(journal.appendCalls).toBe(1);
    expect(journal.entries).toHaveLength(1);
    expect(signer.calls).toBe(1);
    expect(journal.quarantines).toMatchObject([{ rejectionCode: "transition_invalid" }]);
  });

  it("rejects wrong, missing, duplicate, pre-boundary, revoked, and superseded incoming links without moving a head", async () => {
    const valid = transitionRecord({
      auditEventId: "transition-user-valid",
      affectedPurpose: "user_audit",
      affectedOutgoingKeyId: "user-key-old",
      affectedIncomingKeyId: "user-key-new",
      signingKeyId: "service-key-rotation",
    });
    const cases: readonly {
      readonly name: string;
      readonly configure: (authority: RecordingAuthority, journal: RecordingJournal, setNow: (value: string) => void) => void;
    }[] = [
      {
        name: "wrong",
        configure: (authority) => {
          authority.resolution = {
            status: "required_transition",
            transition: transitionRecord({
              auditEventId: "transition-user-wrong",
              affectedPurpose: "user_audit",
              affectedOutgoingKeyId: "user-key-old",
              affectedIncomingKeyId: "other-incoming-key",
              signingKeyId: "service-key-rotation",
            }),
          };
        },
      },
      { name: "missing", configure: (authority) => { authority.resolveError = new TypeError("missing transition link"); } },
      {
        name: "duplicate",
        configure: (authority, journal) => {
          authority.resolution = { status: "required_transition", transition: valid };
          journal.forcedIncomingUse = { hasPriorUse: false, firstTransitionId: valid.auditEventId };
        },
      },
      {
        name: "pre-boundary",
        configure: (authority, _journal, setNow) => {
          authority.resolution = { status: "required_transition", transition: valid };
          setNow("2026-08-23T00:00:10Z");
        },
      },
      {
        name: "revoked",
        configure: (authority) => {
          authority.resolution = { status: "required_transition", transition: valid };
          authority.pairError = new TypeError("affected incoming signer is revoked");
        },
      },
      {
        name: "superseded",
        configure: (authority) => {
          authority.resolution = { status: "required_transition", transition: valid };
          authority.pairError = new TypeError("affected incoming signer is superseded");
        },
      },
    ];
    for (const testCase of cases) {
      const { issuer, runtime, journal, authority, txA, setNow } = setup("2026-08-23T00:00:11Z");
      testCase.configure(authority, journal, setNow);
      await expect(runtime.user.append(issueUser(issuer, txA, `audit-invalid-${testCase.name}`, "user-key-new"), userDraft()))
        .rejects.toThrow();
      expect(journal.entries).toHaveLength(0);
      expect(journal.heads).toHaveLength(0);
    }
  });

  it("requires a canonical signed transition before trusting its edge and never links a transition record itself", async () => {
    const { issuer, runtime, journal, authority, signer, txA } = setup("2026-08-23T00:00:11Z");
    const valid = transitionRecord({
      auditEventId: "transition-verify",
      affectedPurpose: "user_audit",
      affectedOutgoingKeyId: "user-key-old",
      affectedIncomingKeyId: "user-key-new",
      signingKeyId: "service-key-rotation",
    });
    authority.resolution = {
      status: "required_transition",
      transition: { ...valid, eventHash: digest("tampered-transition-hash") } as ServiceAuditEvent,
    };
    await expect(runtime.user.append(issueUser(issuer, txA, "audit-tampered-transition", "user-key-new"), userDraft()))
      .rejects.toThrow("stored audit event hash is invalid");
    expect(journal.entries).toHaveLength(0);

    authority.resolution = { status: "required_transition", transition: valid };
    authority.committedSignatureError = new TypeError("transition signature verification failed");
    await expect(runtime.user.append(issueUser(issuer, txA, "audit-bad-transition-signature", "user-key-new"), userDraft()))
      .rejects.toThrow("transition signature verification failed");
    expect(authority.transitionSignatureChecks).toBeGreaterThan(0);
    expect(journal.entries).toHaveLength(0);

    authority.committedSignatureError = null;
    authority.resolution = { status: "required_transition", transition: valid };
    const transition = await runtime.service.append(
      issueService(issuer, txA, "audit-transition-record", "service-key-old"),
      transitionDraft("service_audit", "service-key-old", "service-key-new"),
    );
    expect(transition.eventType).toBe("audit_signing_key_transition");
    expect(transition.signing_key_transition_id).toBeNull();
    expect(authority.transitionResolveCalls).toBe(2);
    expect(signer.calls).toBe(1);
  });

  it("rejects equal affected pairs and the forbidden User/Staff service-signer shortcut before signing", async () => {
    const equal = setup();
    await expect(equal.runtime.service.append(
      issueService(equal.issuer, equal.txA, "audit-equal-key-pair", "service-key-old"),
      transitionDraft("service_audit", "same-key", "same-key"),
    )).rejects.toThrow("key pair must be distinct");
    expect(equal.signer.calls).toBe(0);

    const shortcut = setup();
    await expect(shortcut.runtime.service.append(
      issueService(shortcut.issuer, shortcut.txA, "audit-user-shortcut", "service-key-old"),
      transitionDraft("user_audit", "service-key-old", "user-key-new"),
    )).rejects.toThrow("audit record is invalid");
    expect(shortcut.signer.calls).toBe(0);
  });
});

function serviceDomain(): ServerAuditChainDomain {
  return {
    auditEventKind: "service",
    actorId: "audit-service",
    tenantScope: "workspace",
    accountId: accountA,
    workspaceId: workspaceA,
  };
}

function evidenceEntry(record: PersistedServerAuditEvent): CommittedServerAuditEntry {
  return { record, canonicalEvidence: evidence(record) };
}

function evidence(record: PersistedServerAuditEvent): Uint8Array {
  const transcript = encodeServerAuditEventSignatureTranscript(record);
  const signature = Buffer.from(record.serverSignature, "base64url");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(signature.length, 0);
  return Buffer.concat([Buffer.from(transcript), length, signature]);
}

function digest(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function sameEvidence(left: CommittedServerAuditEntry, right: CommittedServerAuditEntry): boolean {
  return Buffer.from(left.canonicalEvidence).equals(Buffer.from(right.canonicalEvidence))
    && JSON.stringify(left.record) === JSON.stringify(right.record);
}

function sameHead(left: AuditChainHead | null, right: AuditChainHead | null): boolean {
  return left?.chainId === right?.chainId
    && left?.auditSequence === right?.auditSequence
    && left?.eventHash === right?.eventHash;
}
