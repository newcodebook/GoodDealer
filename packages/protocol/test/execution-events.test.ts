import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DRAIN_CHAIN_GENESIS_INPUT,
  DRAIN_PROOF_DIGEST_DOMAIN,
  DRAIN_PROOF_SIGNATURE_DOMAIN,
  DRAIN_STREAMS,
  DRAIN_STREAM_GENESIS_DIGEST,
  deviceAuditEventSchema,
  drainProofSchema,
  encodeAccountDeviceAuditChainDomain,
  encodeDeviceAuditEventSignatureTranscript,
  encodeDrainChainStepInput,
  encodeDrainProofDigestInput,
  encodeDrainProofSignatureTranscript,
  encodeDrainSequenceDomain,
  encodeDrainStreamEnvelope,
  encodeExecutionFactSignatureTranscript,
  encodeWorkspaceDeviceAuditChainDomain,
  executionFactSchema,
} from "../src/execution-events/index";
import {
  checkpointDescriptorSchema,
  mutationPageSchema,
  submittedSyncMutationSchema,
  syncMutationSchema,
} from "../src/workspace/index";
import { encodeDomainSeparatedWireValue } from "../src/wire/index";

const vectors = resolve(import.meta.dirname, "../test-vectors");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function vector(path: string): unknown {
  return JSON.parse(readFileSync(resolve(vectors, path), "utf8"));
}

function digest(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("base64url");
}

function decodeBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

const validDrainVectors = [
  "proof-handoff-three-streams.json",
  "proof-handoff-all-empty.json",
  "proof-handoff-mixed-empty.json",
  "proof-synchronized-backup.json",
] as const;

const invalidDrainVectors = [
  "proof-pending-nonzero.json",
  "proof-contiguous-behind-assigned.json",
  "proof-stream-missing.json",
  "proof-stream-duplicated.json",
  "proof-stream-reordered.json",
  "proof-stream-unknown-name.json",
  "proof-stream-account-device-audit.json",
  "proof-empty-stream-nongenesis-digest.json",
  "proof-handoff-with-backup-binding.json",
  "proof-handoff-missing-request-id.json",
  "proof-backup-with-request-id.json",
  "proof-digest-algorithm-unknown.json",
  "proof-codec-version-two.json",
  "proof-rolling-digest-length.json",
  "proof-lease-epoch-zero.json",
  "proof-expires-before-issued.json",
  "proof-unknown-field.json",
  "proof-snake-case-wire.json",
] as const;

describe("P17 execution-event golden corpus", () => {
  for (const path of ["execution-fact.json"] as const) {
    it(`accepts valid/${path}`, () => {
      expect(executionFactSchema.safeParse(vector(`execution-events/valid/${path}`)).success).toBe(true);
    });
  }

  for (const path of ["device-audit-workspace.json", "device-audit-account.json"] as const) {
    it(`accepts valid/${path}`, () => {
      expect(deviceAuditEventSchema.safeParse(vector(`execution-events/valid/${path}`)).success).toBe(true);
    });
  }

  for (const path of ["mutation-submitted.json", "mutation-server-enriched.json"] as const) {
    it(`accepts valid/${path}`, () => {
      const schema = path === "mutation-submitted.json" ? submittedSyncMutationSchema : syncMutationSchema;
      expect(schema.safeParse(vector(`execution-events/valid/${path}`)).success).toBe(true);
    });
  }

  for (const path of [
    "execution-fact-missing-approved-operation.json",
    "execution-fact-with-received-at.json",
    "execution-fact-with-late-classification.json",
    "execution-fact-evidence-oversize.json",
  ] as const) {
    it(`rejects invalid/${path}`, () => {
      expect(executionFactSchema.safeParse(vector(`execution-events/invalid/${path}`)).success).toBe(false);
    });
  }

  for (const path of [
    "audit-kind-user.json",
    "audit-kind-staff.json",
    "audit-kind-service.json",
    "device-audit-account-with-lease-epoch.json",
    "device-audit-workspace-missing-workspace-id.json",
    "device-audit-with-approved-operation-authorization.json",
  ] as const) {
    it(`rejects invalid/${path}`, () => {
      expect(deviceAuditEventSchema.safeParse(vector(`execution-events/invalid/${path}`)).success).toBe(false);
    });
  }

  it("P17-INV-9 fixes device audit kind before accepting a scope variant", () => {
    const input = vector("execution-events/invalid/audit-kind-user.json");
    const result = deviceAuditEventSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["auditEventKind"]);
  });

  it("P17-INV-10 makes account/workspace scope fields mutually exclusive", () => {
    expect(
      deviceAuditEventSchema.safeParse(
        vector("execution-events/invalid/device-audit-account-with-lease-epoch.json"),
      ).success,
    ).toBe(false);
    expect(
      deviceAuditEventSchema.safeParse(
        vector("execution-events/invalid/device-audit-workspace-missing-workspace-id.json"),
      ).success,
    ).toBe(false);
  });

  it("P17-INV-11 enforces the closed event-type authorization matrix", () => {
    const result = deviceAuditEventSchema.safeParse(
      vector("execution-events/invalid/device-audit-with-approved-operation-authorization.json"),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["authorizationSource"]);
  });

  it("accepts exactly 8 KiB of approved-operation envelope text and rejects 8 KiB plus one", () => {
    const fact = executionFactSchema.parse(vector("execution-events/valid/execution-fact.json"));
    expect(
      executionFactSchema.safeParse({
        ...fact,
        executionAuthorizationEvidence: {
          ...fact.executionAuthorizationEvidence,
          approvedOperationEnvelope: "A".repeat(8192),
        },
      }).success,
    ).toBe(true);
    expect(
      executionFactSchema.safeParse(
        vector("execution-events/invalid/execution-fact-evidence-oversize.json"),
      ).success,
    ).toBe(false);
  });
});

describe("P17 drain proof golden corpus", () => {
  for (const path of validDrainVectors) {
    it(`accepts valid/${path}`, () => {
      expect(drainProofSchema.safeParse(vector(`drain/valid/${path}`)).success).toBe(true);
    });
  }

  for (const path of invalidDrainVectors) {
    it(`rejects invalid/${path}`, () => {
      expect(drainProofSchema.safeParse(vector(`drain/invalid/${path}`)).success).toBe(false);
    });
  }

  it("P17-INV-1/12 freezes exactly three independent stream discriminants in order", () => {
    expect(DRAIN_STREAMS).toEqual(["mutation", "execution_fact", "device_audit"]);
    for (const path of [
      "proof-stream-missing.json",
      "proof-stream-duplicated.json",
      "proof-stream-reordered.json",
      "proof-stream-unknown-name.json",
      "proof-stream-account-device-audit.json",
    ] as const) {
      expect(drainProofSchema.safeParse(vector(`drain/invalid/${path}`)).success).toBe(false);
    }
  });

  it("P17-INV-2/13/14 refuses a proof for a locally gapped or incomplete stream", () => {
    expect(
      drainProofSchema.safeParse(vector("drain/invalid/proof-pending-nonzero.json")).success,
    ).toBe(false);
    expect(
      drainProofSchema.safeParse(vector("drain/invalid/proof-contiguous-behind-assigned.json")).success,
    ).toBe(false);
  });

  it("P17-INV-3 derives sequence domains instead of carrying them on the proof wire", () => {
    const proof = drainProofSchema.parse(vector("drain/valid/proof-handoff-three-streams.json"));
    expect(Object.hasOwn(proof.streams[0], "sequenceDomain")).toBe(false);
    expect(
      encodeDrainSequenceDomain({
        workspaceId: proof.workspaceId,
        sourceDeviceId: proof.sourceDeviceId,
        activeLeaseEpoch: proof.activeLeaseEpoch,
        stream: proof.streams[0].stream,
      }),
    ).toEqual(
      encodeDomainSeparatedWireValue("GOODDEALER-DRAIN-SEQUENCE-DOMAIN-V1", {
        workspaceId: proof.workspaceId,
        sourceDeviceId: proof.sourceDeviceId,
        activeLeaseEpoch: proof.activeLeaseEpoch,
        stream: "mutation",
      }),
    );
  });

  it("P17-INV-15 pins the empty-stream genesis digest", () => {
    expect(DRAIN_STREAM_GENESIS_DIGEST).toBe(digest(DRAIN_CHAIN_GENESIS_INPUT));
    expect(
      drainProofSchema.safeParse(vector("drain/invalid/proof-empty-stream-nongenesis-digest.json"))
        .success,
    ).toBe(false);
  });

  it("P17-INV-16 isolates handoff and synchronized-backup purposes", () => {
    for (const path of [
      "proof-handoff-with-backup-binding.json",
      "proof-handoff-missing-request-id.json",
      "proof-backup-with-request-id.json",
    ] as const) {
      expect(drainProofSchema.safeParse(vector(`drain/invalid/${path}`)).success).toBe(false);
    }
  });
});

describe("P17 canonical byte layouts", () => {
  it("pins canonical transcripts and envelopes to golden digests", () => {
    const fact = executionFactSchema.parse(vector("execution-events/valid/execution-fact.json"));
    const accountAudit = deviceAuditEventSchema.parse(
      vector("execution-events/valid/device-audit-account.json"),
    );
    const workspaceAudit = deviceAuditEventSchema.parse(
      vector("execution-events/valid/device-audit-workspace.json"),
    );
    const proof = drainProofSchema.parse(vector("drain/valid/proof-handoff-three-streams.json"));
    expect({
      mutationEnvelope: digest(encodeDrainStreamEnvelope("mutation", submittedSyncMutationSchema.parse(vector("execution-events/valid/mutation-submitted.json")))),
      executionFactTranscript: digest(encodeExecutionFactSignatureTranscript(fact)),
      executionFactEnvelope: digest(encodeDrainStreamEnvelope("execution_fact", fact)),
      accountAuditTranscript: digest(encodeDeviceAuditEventSignatureTranscript(accountAudit)),
      accountAuditEnvelope: digest(encodeDrainStreamEnvelope("device_audit", accountAudit)),
      workspaceAuditTranscript: digest(encodeDeviceAuditEventSignatureTranscript(workspaceAudit)),
      workspaceAuditEnvelope: digest(encodeDrainStreamEnvelope("device_audit", workspaceAudit)),
      proofTranscript: digest(encodeDrainProofSignatureTranscript(proof)),
      proofDigestInput: digest(encodeDrainProofDigestInput(proof)),
    }).toEqual({
      mutationEnvelope: "-rJZQVVa2abp5-tP_23kG8mnk9-nBBLgtYga1Lpm0AI",
      executionFactTranscript: "wZjiANMqtQcldrMRSG3TWkClnoIUaVyqoL3pHJgdBQQ",
      executionFactEnvelope: "UKQxe32lm0Hr4rutp8FSvJHHljNBwdLBhsSnFxnHebo",
      accountAuditTranscript: "AO_KE_einS6zs8tNRUU5aaT-Pomp4wOnK4YmbsFJYUI",
      accountAuditEnvelope: "fAHpQJ-mescIlXS7HvH8bavuQ8grbXtOcT0qYVdpKCc",
      workspaceAuditTranscript: "qsNW_wdfwHvDVqz2hSNi5FBsSH6hIy6tZ4ktQh8DhQ8",
      workspaceAuditEnvelope: "L2zd005Nd-s1O6qra6AZjmNKizSTubu4tgoxB0bHEjw",
      proofTranscript: "qiD196D0e2kn_0eKxd7UiFQoa68laqzx8cKUQIzDX_8",
      proofDigestInput: "NsJxtr1QEVKfM_-1xKXqCVi9e5zeva_Z18UxqRglrPs",
    });
  });

  it("P17-INV-4 domain-separates workspace and account device-audit chain ids", () => {
    const workspace = encodeWorkspaceDeviceAuditChainDomain({
      workspaceId: "workspace-a",
      sourceDeviceId: "device-a",
      activeLeaseEpoch: 2,
    });
    const account = encodeAccountDeviceAuditChainDomain({
      accountId: "account-a",
      sourceDeviceId: "device-a",
      credentialEpoch: 3,
    });
    expect(workspace).not.toEqual(account);
    expect(decoder.decode(workspace)).toContain("workspace");
    expect(decoder.decode(account)).toContain("account");
  });

  it("P17-INV-5/7/8 keeps mutation submission additive and digest-invariant", () => {
    const submitted = vector("execution-events/valid/mutation-submitted.json");
    const enriched = vector("execution-events/valid/mutation-server-enriched.json");
    const submittedResult = submittedSyncMutationSchema.parse(submitted);
    const enrichedResult = syncMutationSchema.parse(enriched);
    expect(Object.keys(enrichedResult)).toEqual([
      "schemaVersion",
      "mutationId",
      "workspaceId",
      "workspaceSchemaVersion",
      "entityType",
      "entityId",
      "baseRevision",
      "changedFields",
      "sourceDeviceId",
      "activeLeaseEpoch",
      "mutationSequence",
      "serverRevision",
    ]);
    expect(Object.keys(submittedResult)).toEqual(Object.keys(enrichedResult).slice(0, -1));
    expect(encodeDrainStreamEnvelope("mutation", submittedResult)).toEqual(
      encodeDrainStreamEnvelope("mutation", enrichedResult),
    );
    const envelope = decoder.decode(encodeDrainStreamEnvelope("mutation", submittedResult));
    expect(envelope).not.toContain("serverRevision");
    expect(envelope).not.toContain("deviceSignature");
  });

  it("P17-INV-6 appends actual evidence signatures after their transcripts", () => {
    const fact = executionFactSchema.parse(vector("execution-events/valid/execution-fact.json"));
    const audit = deviceAuditEventSchema.parse(
      vector("execution-events/valid/device-audit-workspace.json"),
    );
    const factEnvelope = encodeDrainStreamEnvelope("execution_fact", fact);
    const auditEnvelope = encodeDrainStreamEnvelope("device_audit", audit);
    expect(decoder.decode(factEnvelope)).toContain(fact.deviceSignature);
    expect(decoder.decode(auditEnvelope)).toContain(audit.deviceSignature);
    expect(factEnvelope.slice(0, -4 - fact.deviceSignature.length)).toEqual(
      encodeExecutionFactSignatureTranscript(fact),
    );
    expect(auditEnvelope.slice(0, -4 - audit.deviceSignature.length)).toEqual(
      encodeDeviceAuditEventSignatureTranscript(audit),
    );
  });

  it("P17-INV-7 excludes ExecutionFact server enrichment from the canonical envelope", () => {
    const fact = executionFactSchema.parse(vector("execution-events/valid/execution-fact.json"));
    const enriched = {
      ...fact,
      receivedAt: "2026-08-14T18:00:00Z",
      classification: "late",
      quarantineState: null,
    };
    expect(encodeDrainStreamEnvelope("execution_fact", enriched)).toEqual(
      encodeDrainStreamEnvelope("execution_fact", fact),
    );
  });

  it("P17-INV-18 layers uint32_be framing above canonical envelope bytes", () => {
    const previousDigest = new Uint8Array(32).fill(7);
    const envelope = encoder.encode("canonical-envelope");
    const input = encodeDrainChainStepInput(previousDigest, envelope);
    expect(input.slice(0, 32)).toEqual(previousDigest);
    expect(new DataView(input.buffer, input.byteOffset + 32, 4).getUint32(0, false)).toBe(
      envelope.byteLength,
    );
    expect(input.slice(36)).toEqual(envelope);
    expect(() => encodeDrainChainStepInput(new Uint8Array(31), envelope)).toThrow(
      "previous drain digest must contain exactly 32 bytes",
    );
  });

  it("P17-INV-19 uses distinct signature and proof-digest domains and includes the signature", () => {
    const proof = drainProofSchema.parse(vector("drain/valid/proof-handoff-three-streams.json"));
    const transcript = encodeDrainProofSignatureTranscript(proof);
    const digestInput = encodeDrainProofDigestInput(proof);
    expect(DRAIN_PROOF_SIGNATURE_DOMAIN).not.toBe(DRAIN_PROOF_DIGEST_DOMAIN);
    expect(decoder.decode(transcript)).toContain(DRAIN_PROOF_SIGNATURE_DOMAIN);
    expect(decoder.decode(transcript)).not.toContain(proof.deviceSignature);
    expect(decoder.decode(digestInput)).toContain(DRAIN_PROOF_DIGEST_DOMAIN);
    expect(decoder.decode(digestInput)).toContain(proof.deviceSignature);
  });

  it("keeps protocol source free of hashing, signing, and verification primitives", () => {
    const directory = resolve(import.meta.dirname, "../src/execution-events");
    const source = readdirSync(directory)
      .filter((path) => path.endsWith(".ts"))
      .map((path) => readFileSync(resolve(directory, path), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/node:crypto|globalThis\.crypto|createHash|subtle\.|\.sign\s*\(|\.verify\s*\(/);
  });
});

describe("P17 sha256-chain-v1 golden vectors", () => {
  it("reproduces genesis.json", () => {
    const input = vector("drain/chain/genesis.json") as {
      genesisInputBase64url: string;
      expectedDigest: string;
    };
    expect(DRAIN_CHAIN_GENESIS_INPUT).toEqual(decodeBase64Url(input.genesisInputBase64url));
    expect(digest(DRAIN_CHAIN_GENESIS_INPUT)).toBe(input.expectedDigest);
  });

  for (const path of ["single-record.json", "three-records.json"] as const) {
    it(`P17-INV-17 reproduces ${path}`, () => {
      const input = vector(`drain/chain/${path}`) as {
        steps: readonly {
          previousDigest: string;
          envelopeBase64url: string;
          expectedDigest: string;
        }[];
        expectedDigest: string;
      };
      let actual = "";
      for (const step of input.steps) {
        actual = digest(
          encodeDrainChainStepInput(
            decodeBase64Url(step.previousDigest),
            decodeBase64Url(step.envelopeBase64url),
          ),
        );
        expect(actual).toBe(step.expectedDigest);
      }
      expect(actual).toBe(input.expectedDigest);
    });
  }

  for (const path of ["duplicate-does-not-advance.json", "gap-then-fill.json"] as const) {
    it(`P17-INV-17 reproduces ${path} without arrival-order folding`, () => {
      const input = vector(`drain/chain/${path}`) as {
        records: readonly { sequence: number; envelopeBase64url: string }[];
        expectedDigest: string;
      };
      const pending = new Map<number, Uint8Array>();
      let through = 0;
      let rollingDigest = createHash("sha256").update(DRAIN_CHAIN_GENESIS_INPUT).digest();
      for (const record of input.records) {
        if (record.sequence <= through || pending.has(record.sequence)) continue;
        pending.set(record.sequence, decodeBase64Url(record.envelopeBase64url));
        while (pending.has(through + 1)) {
          const sequence = through + 1;
          rollingDigest = createHash("sha256")
            .update(encodeDrainChainStepInput(rollingDigest, pending.get(sequence)!))
            .digest();
          pending.delete(sequence);
          through = sequence;
        }
      }
      expect(rollingDigest.toString("base64url")).toBe(input.expectedDigest);
    });
  }
});

describe("P17-INV-8 pre-existing workspace corpus remains unchanged", () => {
  const workspaceVectors = resolve(vectors, "workspace-sync");
  const expectedVerdicts: Record<string, boolean> = {
    "valid/checkpoint.json": true,
    "valid/mutation-page.json": true,
    "valid/mutation.json": true,
    "invalid/mutation-base-not-before-server.json": false,
    "invalid/mutation-device-secret.json": false,
    "invalid/mutation-duplicate-field.json": false,
    "invalid/mutation-noncanonical-money.json": false,
    "invalid/mutation-note-control-character.json": false,
    "invalid/mutation-unknown-field.json": false,
    "invalid/mutation-unsafe-revision.json": false,
    "invalid/mutation-unsorted-fields.json": false,
    "invalid/mutation-unsorted-tags.json": false,
    "invalid/page-cross-workspace.json": false,
    "invalid/page-cursor-at-target.json": false,
    "invalid/page-returned-revision-mismatch.json": false,
    "invalid/page-revision-gap.json": false,
    "invalid/page-terminal-before-target.json": false,
  };

  it("preserves every pre-existing vector verdict and keeps mutationPageSchema unchanged", () => {
    const actualPaths = ["valid", "invalid"].flatMap((directory) =>
      readdirSync(resolve(workspaceVectors, directory)).map((path) => `${directory}/${path}`),
    );
    expect(actualPaths.sort()).toEqual(Object.keys(expectedVerdicts).sort());
    for (const [path, expected] of Object.entries(expectedVerdicts)) {
      const input = vector(`workspace-sync/${path}`);
      const schema = path.includes("checkpoint")
        ? checkpointDescriptorSchema
        : path.includes("mutation-page") || path.includes("page-")
          ? mutationPageSchema
          : syncMutationSchema;
      expect(schema.safeParse(input).success, path).toBe(expected);
    }
  });

  it("pins submitted and accepted mutation enrichment boundaries with stable issue paths", () => {
    const accepted = syncMutationSchema.parse(
      vector("execution-events/valid/mutation-server-enriched.json"),
    );

    const zeroSequence = syncMutationSchema.safeParse({
      ...accepted,
      mutationSequence: 0,
    });
    expect(zeroSequence.success).toBe(false);
    if (!zeroSequence.success) {
      expect(zeroSequence.error.issues.map(({ path }) => path)).toContainEqual([
        "mutationSequence",
      ]);
    }

    const { serverRevision: _serverRevision, ...submitted } = accepted;
    const missingServerRevision = syncMutationSchema.safeParse(submitted);
    expect(missingServerRevision.success).toBe(false);
    if (!missingServerRevision.success) {
      expect(missingServerRevision.error.issues.map(({ path }) => path)).toContainEqual([
        "serverRevision",
      ]);
    }

    const enrichedSubmission = submittedSyncMutationSchema.safeParse(accepted);
    expect(enrichedSubmission.success).toBe(false);
    if (!enrichedSubmission.success) {
      expect(enrichedSubmission.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: [], keys: ["serverRevision"] }),
        ]),
      );
    }
  });
});
