import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import * as audit from "../src/audit/index";
import {
  SERVER_AUDIT_EVENT_SCHEMA_VERSION,
  encodeServerAuditChainDomain,
  encodeServerAuditEventHashInput,
  encodeServerAuditEventSignatureTranscript,
  persistedServerAuditEventSchema,
  serverAuditEventDraftSchema,
  serviceAuditEventSchema,
  staffAuditEventSchema,
  userAuditEventSchema,
} from "../src/audit/index";
import type { ServiceAuditEvent } from "../src/audit/index";

const vectors = resolve(import.meta.dirname, "../test-vectors/audit");
const decoder = new TextDecoder();

function vector(path: string): unknown {
  return JSON.parse(readFileSync(resolve(vectors, path), "utf8"));
}

function digest(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("base64url");
}

function transitionPayload(event: ServiceAuditEvent) {
  const payload = event.payloadRedacted;
  if ("action" in payload) throw new TypeError("expected a service key-transition payload");
  return payload;
}

const validVectors = [
  "user-account-session.json",
  "staff-admin-read.json",
  "service-identity-defense.json",
  "service-key-transition-user-audit.json",
  "service-key-transition-staff-audit.json",
  "service-key-transition-service-audit.json",
] as const;

const invalidVectors = [
  "security-kind.json",
  "user-device-field.json",
  "transition-user-pair-equals-signer.json",
  "transition-service-pair-mismatch.json",
  "transition-raw-key-field.json",
] as const;

describe("S1 typed server-audit public contract", () => {
  it("exports exactly the frozen runtime value API", () => {
    expect(Object.keys(audit).sort()).toEqual([
      "SERVER_AUDIT_EVENT_SCHEMA_VERSION",
      "encodeServerAuditChainDomain",
      "encodeServerAuditEventHashInput",
      "encodeServerAuditEventSignatureTranscript",
      "persistedServerAuditEventSchema",
      "serverAuditEventDraftSchema",
      "serviceAuditEventSchema",
      "staffAuditEventSchema",
      "userAuditEventSchema",
    ]);
  });

  it("keeps the six frozen type exports and no unapproved public names in the source entrypoint", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../src/audit/index.ts"), "utf8");
    for (const typeName of [
      "PersistedServerAuditEvent",
      "ServerAuditEventDraft",
      "UserAuditEvent",
      "StaffAuditEvent",
      "ServiceAuditEvent",
      "ServerAuditChainDomain",
    ]) {
      expect(source).toContain(`export type ${typeName} =`);
    }
    expect(source).not.toMatch(/export (?:const|function|type) (?:SecurityAuditEvent|SecurityAuditEmission|AuditRepository|AuditReader|KeyRegistry|Signer|Verifier)/);
  });

  it("pins the schema version", () => {
    expect(SERVER_AUDIT_EVENT_SCHEMA_VERSION).toBe(1);
  });
});

describe("S1 server-audit strict corpus", () => {
  for (const path of validVectors) {
    it(`accepts valid/${path}`, () => {
      expect(persistedServerAuditEventSchema.safeParse(vector(`valid/${path}`)).success).toBe(true);
    });
  }

  for (const path of invalidVectors) {
    it(`rejects invalid/${path}`, () => {
      expect(persistedServerAuditEventSchema.safeParse(vector(`invalid/${path}`)).success).toBe(false);
    });
  }

  it("accepts only user, staff, and service at the server boundary", () => {
    const user = vector("valid/user-account-session.json") as Record<string, unknown>;
    for (const auditEventKind of ["device", "security", "sunset", "unknown"] as const) {
      expect(
        persistedServerAuditEventSchema.safeParse({
          ...user,
          auditEventKind,
        }).success,
      ).toBe(false);
    }
  });

  it("enforces the truthful kind, actor, authorization, key-purpose, and scope matrix", () => {
    const user = userAuditEventSchema.parse(vector("valid/user-account-session.json"));
    const staff = staffAuditEventSchema.parse(vector("valid/staff-admin-read.json"));
    const service = serviceAuditEventSchema.parse(vector("valid/service-identity-defense.json"));

    expect(userAuditEventSchema.safeParse({ ...user, actorKind: "staff" }).success).toBe(false);
    expect(userAuditEventSchema.safeParse({ ...user, authorizationSource: "service_identity" }).success).toBe(false);
    expect(userAuditEventSchema.safeParse({ ...user, signingKeyPurpose: "staff_audit" }).success).toBe(false);
    expect(
      userAuditEventSchema.safeParse({
        ...user,
        tenantScope: "global",
        accountId: null,
        workspaceId: null,
      }).success,
    ).toBe(false);

    expect(staffAuditEventSchema.safeParse({ ...staff, actorKind: "user" }).success).toBe(false);
    expect(staffAuditEventSchema.safeParse({ ...staff, authorizationSource: "user_session" }).success).toBe(false);
    expect(serviceAuditEventSchema.safeParse({ ...service, actorKind: "staff" }).success).toBe(false);
    expect(serviceAuditEventSchema.safeParse({ ...service, signingKeyPurpose: "user_audit" }).success).toBe(false);
  });

  it("accepts every frozen ordinary action family only with its matching closed payload", () => {
    const user = userAuditEventSchema.parse(vector("valid/user-account-session.json"));
    const staff = staffAuditEventSchema.parse(vector("valid/staff-admin-read.json"));
    const service = serviceAuditEventSchema.parse(vector("valid/service-identity-defense.json"));
    const userPayloads = [
      {
        eventType: "account_session",
        payloadRedacted: user.payloadRedacted,
      },
      {
        eventType: "account_security",
        payloadRedacted: {
          action: "account_security",
          outcome: "accepted",
          reason: "password_changed",
          securityEpoch: 3,
          beforeDigest: null,
          afterDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          correlationRef: "correlation-audit-ref-2",
        },
      },
      {
        eventType: "device_binding",
        payloadRedacted: {
          action: "device_binding",
          outcome: "requested",
          reason: "user_requested",
          bindingAuditRef: "binding-audit-ref-1",
          beforeDigest: null,
          afterDigest: null,
        },
      },
      {
        eventType: "data_rights",
        payloadRedacted: {
          action: "data_rights",
          outcome: "requested",
          reason: "export",
          dataRightsRequestRef: "data-rights-request-1",
          beforeDigest: null,
          afterDigest: null,
        },
      },
    ] as const;
    const staffPayloads = [
      {
        eventType: "admin_read",
        payloadRedacted: staff.payloadRedacted,
      },
      {
        eventType: "repair_command",
        payloadRedacted: {
          action: "repair_command",
          outcome: "accepted",
          reason: "authorized",
          adminPurposeRef: { kind: "support_case", reference: "support-case-1" },
          authorizationDigest: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          commandDigest: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
          beforeDigest: null,
          afterDigest: null,
        },
      },
      {
        eventType: "control",
        payloadRedacted: {
          action: "control",
          controlArea: "license",
          outcome: "completed",
          reason: "authorized",
          adminPurposeRef: { kind: "data_rights_request", reference: "data-rights-request-1" },
          authorizationDigest: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
          controlDigest: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
          beforeDigest: null,
          afterDigest: null,
        },
      },
      {
        eventType: "security_incident_staff_action",
        payloadRedacted: {
          action: "security_incident_staff_action",
          outcome: "acknowledged",
          reason: "authorized",
          incidentRef: "security-incident-1",
          authorizationDigest: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
          beforeDigest: null,
          afterDigest: null,
        },
      },
    ] as const;
    const servicePayloads = [
      {
        eventType: "identity_defense",
        payloadRedacted: service.payloadRedacted,
      },
      {
        eventType: "device_admission",
        payloadRedacted: {
          action: "device_admission",
          outcome: "admitted",
          reason: "binding_verified",
          admissionRef: "device-admission-1",
          evidenceDigest: "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
        },
      },
      {
        eventType: "security_incident",
        payloadRedacted: {
          action: "security_incident",
          outcome: "opened",
          reason: "detection",
          incidentRef: "security-incident-1",
          evidenceDigest: "HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH",
        },
      },
      {
        eventType: "compliance",
        payloadRedacted: {
          action: "compliance",
          outcome: "started",
          reason: "export",
          dataRightsRequestRef: "data-rights-request-1",
          lifecycleDigest: "IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII",
        },
      },
      {
        eventType: "job",
        payloadRedacted: {
          action: "job",
          outcome: "completed",
          reason: "authorized",
          jobAuditRef: "job-audit-ref-1",
          authorizationDigest: "JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ",
          outcomeDigest: "KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK",
        },
      },
      {
        eventType: "notification",
        payloadRedacted: {
          action: "notification",
          outcome: "sent",
          reason: "requested",
          notificationAuditRef: "notification-audit-ref-1",
          resultCode: "accepted",
          requestDigest: "LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL",
        },
      },
    ] as const;

    for (const testCase of userPayloads) {
      expect(userAuditEventSchema.safeParse({ ...user, ...testCase }).success, testCase.eventType).toBe(true);
    }
    for (const testCase of staffPayloads) {
      expect(staffAuditEventSchema.safeParse({ ...staff, ...testCase }).success, testCase.eventType).toBe(true);
    }
    for (const testCase of servicePayloads) {
      expect(serviceAuditEventSchema.safeParse({ ...service, ...testCase }).success, testCase.eventType).toBe(true);
    }
    expect(
      userAuditEventSchema.safeParse({ ...user, eventType: "account_security" }).success,
    ).toBe(false);
  });

  it("rejects Device, Sunset, Drain, lease, ApprovedOperation, signature, secret, and arbitrary-payload fields", () => {
    const user = userAuditEventSchema.parse(vector("valid/user-account-session.json"));
    for (const [field, value] of [
      ["sourceDeviceId", "device-a"],
      ["activeLeaseEpoch", 2],
      ["credentialEpoch", 2],
      ["deviceSignature", "device-signature"],
      ["drainProof", "drain-proof"],
      ["approvedOperationId", "approved-operation"],
      ["sunsetInstallationId", "sunset-installation"],
      ["lease", "lease"],
    ] as const) {
      expect(userAuditEventSchema.safeParse({ ...user, [field]: value }).success, field).toBe(false);
    }
    expect(
      userAuditEventSchema.safeParse({
        ...user,
        payloadRedacted: {
          ...user.payloadRedacted,
          password: "audit-secret-canary",
        },
      }).success,
    ).toBe(false);
    for (const field of ["token", "kmsLocator", "rawKey", "email", "ipAddress", "userAgent"] as const) {
      expect(
        userAuditEventSchema.safeParse({
          ...user,
          payloadRedacted: {
            ...user.payloadRedacted,
            [field]: "audit-secret-canary",
          },
        }).success,
        field,
      ).toBe(false);
    }
    expect(userAuditEventSchema.safeParse({ ...user, unknownServerAuditField: true }).success).toBe(false);
    expect(
      userAuditEventSchema.safeParse({
        ...user,
        payloadRedacted: {
          ...user.payloadRedacted,
          metadata: { arbitrary: ["json"] },
        },
      }).success,
    ).toBe(false);
  });

  it("requires the exact snake_case signing_key_transition_id field", () => {
    const user = userAuditEventSchema.parse(vector("valid/user-account-session.json"));
    const { signing_key_transition_id: transitionId, ...withoutTransitionId } = user;
    expect(userAuditEventSchema.safeParse(withoutTransitionId).success).toBe(false);
    expect(
      userAuditEventSchema.safeParse({
        ...withoutTransitionId,
        signingKeyTransitionId: transitionId,
      }).success,
    ).toBe(false);
    expect(
      userAuditEventSchema.safeParse({
        ...user,
        signing_key_transition_id: "server-audit-transition-user-1",
      }).success,
    ).toBe(true);
    expect(
      userAuditEventSchema.safeParse({
        ...user,
        signing_key_transition_id: user.auditEventId,
      }).success,
    ).toBe(false);
  });
});

describe("S1 transition constraints", () => {
  it("accepts all three affected purposes while keeping the transition record service-signed", () => {
    for (const path of [
      "service-key-transition-user-audit.json",
      "service-key-transition-staff-audit.json",
      "service-key-transition-service-audit.json",
    ] as const) {
      const event = serviceAuditEventSchema.parse(vector(`valid/${path}`));
      expect(event.eventType).toBe("audit_signing_key_transition");
      expect(event.actorKind).toBe("service");
      expect(event.authorizationSource).toBe("service_identity");
      expect(event.signingKeyPurpose).toBe("service_audit");
      expect(event.signing_key_transition_id).toBeNull();
    }
  });

  it("rejects the non-transition service payload, wrong actor-source, boundary, and self-link", () => {
    const transition = serviceAuditEventSchema.parse(
      vector("valid/service-key-transition-service-audit.json"),
    );
    const payload = transitionPayload(transition);
    expect(
      serviceAuditEventSchema.safeParse({
        ...transition,
        eventType: "identity_defense",
      }).success,
    ).toBe(false);
    expect(
      serviceAuditEventSchema.safeParse({
        ...transition,
        authorizationSource: "tenant_job_context",
      }).success,
    ).toBe(false);
    expect(
      serviceAuditEventSchema.safeParse({
        ...transition,
        signing_key_transition_id: "server-audit-transition-service-1",
      }).success,
    ).toBe(false);
    expect(
      serviceAuditEventSchema.safeParse({
        ...transition,
        payloadRedacted: {
          ...payload,
          effectiveBoundary: {
            ...payload.effectiveBoundary,
            transitionAuditSequence: transition.auditSequence + 1,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("permits signer-pair equality only for the affected service_audit purpose", () => {
    const userPurposeTransition = serviceAuditEventSchema.parse(
      vector("valid/service-key-transition-user-audit.json"),
    );
    const servicePurposeTransition = serviceAuditEventSchema.parse(
      vector("valid/service-key-transition-service-audit.json"),
    );
    const userPayload = transitionPayload(userPurposeTransition);
    const servicePayload = transitionPayload(servicePurposeTransition);

    expect(
      serviceAuditEventSchema.safeParse({
        ...userPurposeTransition,
        payloadRedacted: {
          ...userPayload,
          affectedOutgoingPublicKeyId: userPurposeTransition.signingKeyId,
          affectedOutgoingPublicKeyVersion: userPurposeTransition.signingKeyVersion,
        },
      }).success,
    ).toBe(false);
    expect(
      serviceAuditEventSchema.safeParse({
        ...servicePurposeTransition,
        payloadRedacted: {
          ...servicePayload,
          affectedOutgoingPublicKeyId: "different-service-audit-key",
        },
      }).success,
    ).toBe(false);
  });
});

describe("S1 draft boundary", () => {
  it("accepts only closed semantic action input and excludes server-derived fields", () => {
    const draft = {
      schemaVersion: SERVER_AUDIT_EVENT_SCHEMA_VERSION,
      auditEventKind: "user",
      eventType: "account_session",
      targetType: "account_session",
      targetRef: "account-session-audit-ref-1",
      payloadRedacted: {
        action: "account_session",
        outcome: "started",
        reason: "user_requested",
        sessionAuditRef: "session-audit-ref-1",
        securityEpoch: 2,
        correlationRef: "correlation-audit-ref-1",
      },
    };
    expect(serverAuditEventDraftSchema.safeParse(draft).success).toBe(true);

    for (const [field, value] of [
      ["auditEventId", "server-audit-user-1"],
      ["tenantScope", "account"],
      ["accountId", "account-a"],
      ["workspaceId", null],
      ["actorKind", "user"],
      ["actorId", "user-a"],
      ["authorizationSource", "user_session"],
      ["authorizationContextHash", "IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII"],
      ["chainId", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"],
      ["auditSequence", 1],
      ["previousHash", "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG"],
      ["eventHash", "HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH"],
      ["occurredAt", "2026-08-22T14:10:00Z"],
      ["cryptographicSignerKind", "gooddealer_audit_service"],
      ["cryptographicSignerId", "gooddealer-audit-service"],
      ["signingKeyPurpose", "user_audit"],
      ["signingKeyId", "user-audit-key-1"],
      ["signingKeyVersion", 1],
      ["signatureTranscriptVersion", 1],
      ["serverSignature", "c2VydmVyLXNpZ25hdHVyZQ"],
      ["signing_key_transition_id", null],
    ] as const) {
      expect(serverAuditEventDraftSchema.safeParse({ ...draft, [field]: value }).success, field).toBe(false);
    }
  });

  it("requires a transition draft to omit the database-derived effective boundary", () => {
    const completed = serviceAuditEventSchema.parse(
      vector("valid/service-key-transition-user-audit.json"),
    );
    const payload = transitionPayload(completed);
    const draft = {
      schemaVersion: SERVER_AUDIT_EVENT_SCHEMA_VERSION,
      auditEventKind: "service" as const,
      eventType: "audit_signing_key_transition" as const,
      targetType: completed.targetType,
      targetRef: completed.targetRef,
      payloadRedacted: {
        affectedSigningKeyPurpose: payload.affectedSigningKeyPurpose,
        affectedOutgoingPublicKeyId: payload.affectedOutgoingPublicKeyId,
        affectedOutgoingPublicKeyVersion: payload.affectedOutgoingPublicKeyVersion,
        affectedIncomingPublicKeyId: payload.affectedIncomingPublicKeyId,
        affectedIncomingPublicKeyVersion: payload.affectedIncomingPublicKeyVersion,
        custodyApprovalDigest: payload.custodyApprovalDigest,
      },
    };
    expect(serverAuditEventDraftSchema.safeParse(draft).success).toBe(true);
    expect(
      serverAuditEventDraftSchema.safeParse({
        ...draft,
        payloadRedacted: {
          ...draft.payloadRedacted,
          effectiveBoundary: payload.effectiveBoundary,
        },
      }).success,
    ).toBe(false);
  });
});

describe("S1 canonical bytes", () => {
  it("domain-separates strict chain identities", () => {
    const account = encodeServerAuditChainDomain({
      auditEventKind: "user",
      tenantScope: "account",
      accountId: "account-a",
      workspaceId: null,
      actorId: "user-a",
    });
    const workspace = encodeServerAuditChainDomain({
      auditEventKind: "user",
      tenantScope: "workspace",
      accountId: "account-a",
      workspaceId: "workspace-a",
      actorId: "user-a",
    });
    expect(account).not.toEqual(workspace);
    expect(decoder.decode(account)).toContain("GOODDEALER-SERVER-AUDIT-CHAIN-V1");
    expect(() =>
      encodeServerAuditChainDomain({
        auditEventKind: "user",
        tenantScope: "global",
        accountId: null,
        workspaceId: null,
        actorId: "user-a",
      }),
    ).toThrow();
  });

  it("uses deterministic distinct canonical hash and signature transcripts", () => {
    const user = userAuditEventSchema.parse(vector("valid/user-account-session.json"));
    const hashInput = encodeServerAuditEventHashInput(user);
    const signatureInput = encodeServerAuditEventSignatureTranscript(user);
    expect(encodeServerAuditEventHashInput({ ...user })).toEqual(hashInput);
    expect(hashInput).not.toEqual(signatureInput);
    expect(decoder.decode(hashInput)).toContain("GOODDEALER-SERVER-AUDIT-EVENT-V1");
    expect(decoder.decode(signatureInput)).toContain("GOODDEALER-SERVER-AUDIT-SIGNATURE-V1");
    expect(decoder.decode(hashInput)).not.toContain(user.eventHash);
    expect(decoder.decode(hashInput)).not.toContain(user.serverSignature);
    expect(decoder.decode(signatureInput)).toContain(user.eventHash);
    expect(decoder.decode(signatureInput)).not.toContain(user.serverSignature);
  });

  it("binds scope, actor, payload, signer, and the signed cross-chain transition id", () => {
    const user = userAuditEventSchema.parse(vector("valid/user-account-session.json"));
    const baseline = encodeServerAuditEventHashInput(user);
    const cases = [
      {
        name: "scope",
        value: { ...user, tenantScope: "workspace" as const, workspaceId: "workspace-a" },
      },
      { name: "actor", value: { ...user, actorId: "user-b" } },
      {
        name: "payload",
        value: {
          ...user,
          payloadRedacted: { ...user.payloadRedacted, outcome: "refreshed" as const },
        },
      },
      { name: "signer", value: { ...user, signingKeyId: "user-audit-key-2" } },
      {
        name: "transition",
        value: { ...user, signing_key_transition_id: "server-audit-transition-user-1" },
      },
    ] as const;
    for (const testCase of cases) {
      expect(encodeServerAuditEventHashInput(testCase.value), testCase.name).not.toEqual(baseline);
      expect(
        encodeServerAuditEventSignatureTranscript(testCase.value),
        `${testCase.name} signature`,
      ).not.toEqual(encodeServerAuditEventSignatureTranscript(user));
    }
  });

  it("binds the distinct affected pair and transition identity in canonical bytes", () => {
    const transition = serviceAuditEventSchema.parse(
      vector("valid/service-key-transition-user-audit.json"),
    );
    const baseline = encodeServerAuditEventHashInput(transition);
    const changedPair = {
      ...transition,
      payloadRedacted: {
        ...transition.payloadRedacted,
        affectedIncomingPublicKeyId: "user-audit-key-incoming-2",
      },
    };
    expect(encodeServerAuditEventHashInput(changedPair)).not.toEqual(baseline);
    expect(encodeServerAuditEventSignatureTranscript(changedPair)).not.toEqual(
      encodeServerAuditEventSignatureTranscript(transition),
    );
  });

  it("pins canonical audit vectors", () => {
    const user = userAuditEventSchema.parse(vector("valid/user-account-session.json"));
    const transition = serviceAuditEventSchema.parse(
      vector("valid/service-key-transition-service-audit.json"),
    );
    expect({
      userHashInput: digest(encodeServerAuditEventHashInput(user)),
      userSignatureTranscript: digest(encodeServerAuditEventSignatureTranscript(user)),
      transitionHashInput: digest(encodeServerAuditEventHashInput(transition)),
      transitionSignatureTranscript: digest(encodeServerAuditEventSignatureTranscript(transition)),
    }).toEqual({
      userHashInput: "DAQwc4EyjCQEYCwscYEO4f0CmqJbXOpRMy4n4tupVkQ",
      userSignatureTranscript: "WbOPt3EFxKeMCegeze_Rv8f0O8B1Uds5gko-rBBO1k0",
      transitionHashInput: "VYOkEYPDEHVLFz1MqJgaP5YqikiZzjUqB7Tahc72zmU",
      transitionSignatureTranscript: "voos5d6Jy1MF5s9aH7bM4xxSeVjsp4fOCQYDWxxhosk",
    });
  });

  it("keeps protocol parsing and encoding free of cryptographic and storage operations", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../src/audit/index.ts"), "utf8");
    expect(source).not.toMatch(/node:crypto|globalThis\.crypto|createHash|subtle\.|\.sign\s*\(|\.verify\s*\(/);
    expect(source).not.toMatch(/from ["'](?:pg|postgres|node:fs|node:net|node:tls)["']/);
    expect(source).not.toMatch(/AuditRepository|AuditReader|KeyRegistry|rawPublicKey|publicKeyBody|kmsLocator/);
  });
});
