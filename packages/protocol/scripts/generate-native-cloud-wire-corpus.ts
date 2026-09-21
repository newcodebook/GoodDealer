import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  workspaceCheckpointReadResponseSchema,
  workspaceMutationPullResponseSchema,
  workspaceMutationPushResponseSchema,
} from "../src/workspace/index.ts";
import { cloudflareDnsProjectionAckSchema } from "../src/workspace-observations/cloudflare-dns.ts";

// This generator intentionally calls only public protocol schemas. Rust remains a handwritten
// implementation; the corpus is the cross-language contract and does not inspect Zod internals.
const fixturePage = JSON.parse(
  readFileSync(resolve("test-vectors/workspace-sync/valid/mutation-page.json"), "utf8"),
) as Record<string, unknown>;
const fixtureCheckpoint = JSON.parse(
  readFileSync(resolve("test-vectors/workspace-sync/valid/checkpoint.json"), "utf8"),
) as Record<string, unknown>;

type Kind = "push-response" | "pull-response" | "checkpoint-response" | "projection-response";
type GeneratedCase = { name: string; kind: Kind; value: unknown };
type RawCase = { name: string; kind: Kind; wire: string; schemaAccepted?: boolean };

const digest43 = "A".repeat(43);
const projectionDigest = "a".repeat(64);
const observationId = "123e4567-e89b-42d3-a456-426614174000";
const pushRejectionCodes = [
  "SYNC_SCHEMA_UNSUPPORTED",
  "SYNC_INPUT_REJECTED",
  "SYNC_AUTHORIZATION_REJECTED",
  "SYNC_TENANT_UNRESOLVED",
  "SYNC_IDEMPOTENCY_CONFLICT",
  "SYNC_STORAGE_REJECTED",
] as const;
const pullRejectionCodes = [
  "SYNC_SCHEMA_UNSUPPORTED",
  "SYNC_INPUT_REJECTED",
  "SYNC_AUTHORIZATION_REJECTED",
  "SYNC_TENANT_UNRESOLVED",
  "SYNC_CURSOR_CONFLICT",
  "SYNC_REBOOTSTRAP_REQUIRED",
  "SYNC_STORAGE_REJECTED",
] as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cursorDigest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function schemaFor(kind: Kind) {
  return kind === "push-response"
    ? workspaceMutationPushResponseSchema
    : kind === "pull-response"
      ? workspaceMutationPullResponseSchema
      : kind === "checkpoint-response"
        ? workspaceCheckpointReadResponseSchema
        : cloudflareDnsProjectionAckSchema;
}

const pushAccepted = workspaceMutationPushResponseSchema.parse({
  schemaVersion: 2,
  accepted: true,
  acknowledgements: [
    { mutationId: "mutation-5", deviceMutationSequence: 9, serverRevision: 5, duplicate: false },
  ],
  headServerRevision: 5,
});
const pullAccepted = workspaceMutationPullResponseSchema.parse({
  schemaVersion: 2,
  accepted: true,
  page: fixturePage,
  confirmedThrough: 4,
  pendingDelivery: {
    generation: 1,
    fromServerRevisionExclusive: 4,
    throughServerRevisionInclusive: 5,
    targetServerRevision: 5,
    pageDigest: fixturePage.pageDigest,
    nextCursorDigest: null,
    predecessorConfirmationDigest: null,
    expiresAt: "2026-09-16T00:01:00Z",
  },
  confirmToken: "confirm_1",
});
const projectionAccepted = cloudflareDnsProjectionAckSchema.parse({
  schemaVersion: 1,
  accepted: true,
  observationId,
  leaseEpoch: 7,
  sourceSequence: 1,
  canonicalRequestDigest: projectionDigest,
  observationSequence: 1,
  disposition: "current",
});

const continuationCursor = "cursor_6";
const continuationPage = {
  ...clone(fixturePage),
  throughServerRevisionInclusive: 6,
  nextCursor: continuationCursor,
};
const continuationPull = workspaceMutationPullResponseSchema.parse({
  ...clone(pullAccepted),
  page: continuationPage,
  pendingDelivery: {
    ...clone(pullAccepted.pendingDelivery),
    targetServerRevision: 6,
    nextCursorDigest: cursorDigest(continuationCursor),
    predecessorConfirmationDigest: digest43,
    expiresAt: "2000-02-29T23:59:59Z",
  },
});

const allCanonicalMutation = {
  ...clone((fixturePage.mutations as Record<string, unknown>[])[0]),
  changedFields: [
    { fieldPath: "note", value: "Line one\nLine two" },
    { fieldPath: "portfolioId", value: "portfolio-1" },
    { fieldPath: "tags", value: ["brandable", "premium"] },
    { fieldPath: "targetPrice", value: { currency: "USD", amount: "1200.125" } },
  ],
};
const allCanonicalPull = workspaceMutationPullResponseSchema.parse({
  ...clone(pullAccepted),
  page: { ...clone(fixturePage), mutations: [allCanonicalMutation] },
});

const valid: GeneratedCase[] = [
  { name: "push-accepted-new", kind: "push-response", value: pushAccepted },
  {
    name: "push-accepted-duplicate",
    kind: "push-response",
    value: workspaceMutationPushResponseSchema.parse({
      ...clone(pushAccepted),
      acknowledgements: [{ ...pushAccepted.acknowledgements[0], duplicate: true }],
    }),
  },
  ...pushRejectionCodes.map((code) => ({
    name: `push-rejected-${code.toLowerCase().replaceAll("_", "-")}`,
    kind: "push-response" as const,
    value: workspaceMutationPushResponseSchema.parse({
      schemaVersion: 2,
      accepted: false,
      code,
      correlationId: `correlation-push-${code.toLowerCase()}`,
    }),
  })),
  { name: "pull-accepted-terminal", kind: "pull-response", value: pullAccepted },
  { name: "pull-accepted-continuation", kind: "pull-response", value: continuationPull },
  { name: "pull-accepted-all-canonical-fields", kind: "pull-response", value: allCanonicalPull },
  ...pullRejectionCodes.map((code) => ({
    name: `pull-rejected-${code.toLowerCase().replaceAll("_", "-")}-checkpoint-null`,
    kind: "pull-response" as const,
    value: workspaceMutationPullResponseSchema.parse({
      schemaVersion: 2,
      accepted: false,
      code,
      checkpoint: null,
      correlationId: `correlation-pull-${code.toLowerCase()}`,
    }),
  })),
  {
    name: "pull-rebootstrap-required-checkpoint-present",
    kind: "pull-response",
    value: workspaceMutationPullResponseSchema.parse({
      schemaVersion: 2,
      accepted: false,
      code: "SYNC_REBOOTSTRAP_REQUIRED",
      checkpoint: fixtureCheckpoint,
      correlationId: "correlation-pull-rebootstrap-checkpoint",
    }),
  },
  {
    name: "checkpoint-present",
    kind: "checkpoint-response",
    value: workspaceCheckpointReadResponseSchema.parse({ schemaVersion: 2, checkpoint: fixtureCheckpoint }),
  },
  {
    name: "checkpoint-null",
    kind: "checkpoint-response",
    value: workspaceCheckpointReadResponseSchema.parse({ schemaVersion: 2, checkpoint: null }),
  },
  { name: "projection-current", kind: "projection-response", value: projectionAccepted },
  {
    name: "projection-stale",
    kind: "projection-response",
    value: cloudflareDnsProjectionAckSchema.parse({
      ...clone(projectionAccepted),
      observationSequence: Number.MAX_SAFE_INTEGER,
      disposition: "stale",
    }),
  },
];

function mutationCase(
  name: string,
  mutate: (mutation: Record<string, unknown>) => void,
): GeneratedCase {
  const value = clone(pullAccepted);
  const mutation = (value.page.mutations as Record<string, unknown>[])[0]!;
  mutate(mutation);
  return { name, kind: "pull-response", value };
}

function changedFieldCase(
  name: string,
  fieldPath: "note" | "portfolioId" | "tags" | "targetPrice",
  value: unknown,
): GeneratedCase {
  return mutationCase(name, (mutation) => {
    mutation.changedFields = [{ fieldPath, value }];
  });
}

const invalid: GeneratedCase[] = [
  { name: "push-unknown-top-level", kind: "push-response", value: { ...clone(pushAccepted), token: "forbidden" } },
  { name: "push-unsafe-head-revision", kind: "push-response", value: { ...clone(pushAccepted), headServerRevision: Number.MAX_SAFE_INTEGER + 1 } },
  { name: "push-ack-wrong-mutation", kind: "push-response", value: { ...clone(pushAccepted), acknowledgements: [{ mutationId: "other", deviceMutationSequence: 9, serverRevision: 5, duplicate: false }] } },
  { name: "push-ack-wrong-sequence", kind: "push-response", value: { ...clone(pushAccepted), acknowledgements: [{ mutationId: "mutation-5", deviceMutationSequence: 10, serverRevision: 5, duplicate: false }] } },
  { name: "push-ack-zero-server-revision", kind: "push-response", value: { ...clone(pushAccepted), acknowledgements: [{ ...pushAccepted.acknowledgements[0], serverRevision: 0 }] } },
  { name: "push-ack-more-than-head", kind: "push-response", value: { ...clone(pushAccepted), acknowledgements: [{ ...pushAccepted.acknowledgements[0], serverRevision: 6 }] } },
  { name: "push-rejected-unknown-code", kind: "push-response", value: { schemaVersion: 2, accepted: false, code: "SYNC_UNAVAILABLE", correlationId: "correlation-invalid" } },
  { name: "push-rejected-invalid-correlation", kind: "push-response", value: { schemaVersion: 2, accepted: false, code: "SYNC_INPUT_REJECTED", correlationId: "bad correlation" } },
  { name: "pull-confirmed-through-ahead", kind: "pull-response", value: { ...clone(pullAccepted), confirmedThrough: 5 } },
  { name: "pull-page-workspace-substitution", kind: "pull-response", value: { ...clone(pullAccepted), page: { ...clone(fixturePage), workspaceId: "workspace-other" } } },
  { name: "pull-page-from-revision-substitution", kind: "pull-response", value: { ...clone(pullAccepted), page: { ...clone(fixturePage), fromServerRevisionExclusive: 3 } } },
  { name: "pull-delivery-page-digest-mismatch", kind: "pull-response", value: { ...clone(pullAccepted), pendingDelivery: { ...clone(pullAccepted.pendingDelivery), pageDigest: digest43 } } },
  { name: "pull-delivery-next-digest-without-cursor", kind: "pull-response", value: { ...clone(pullAccepted), pendingDelivery: { ...clone(pullAccepted.pendingDelivery), nextCursorDigest: digest43 } } },
  { name: "pull-continuation-missing-next-digest", kind: "pull-response", value: { ...clone(continuationPull), pendingDelivery: { ...clone(continuationPull.pendingDelivery), nextCursorDigest: null } } },
  { name: "pull-continuation-wrong-next-digest", kind: "pull-response", value: { ...clone(continuationPull), pendingDelivery: { ...clone(continuationPull.pendingDelivery), nextCursorDigest: digest43 } } },
  { name: "pull-invalid-real-date", kind: "pull-response", value: { ...clone(pullAccepted), pendingDelivery: { ...clone(pullAccepted.pendingDelivery), expiresAt: "2026-02-29T00:00:00Z" } } },
  { name: "pull-noncanonical-timestamp-millis", kind: "pull-response", value: { ...clone(pullAccepted), pendingDelivery: { ...clone(pullAccepted.pendingDelivery), expiresAt: "2026-09-16T00:01:00.000Z" } } },
  { name: "pull-page-digest-too-short", kind: "pull-response", value: { ...clone(pullAccepted), page: { ...clone(fixturePage), pageDigest: "A".repeat(42) } } },
  { name: "pull-page-digest-padding", kind: "pull-response", value: { ...clone(pullAccepted), page: { ...clone(fixturePage), pageDigest: `${"A".repeat(42)}=` } } },
  { name: "pull-rejected-unknown-code", kind: "pull-response", value: { schemaVersion: 2, accepted: false, code: "SYNC_UNAVAILABLE", checkpoint: null, correlationId: "correlation-invalid" } },
  { name: "pull-rejected-missing-checkpoint", kind: "pull-response", value: { schemaVersion: 2, accepted: false, code: "SYNC_REBOOTSTRAP_REQUIRED", correlationId: "correlation-invalid" } },
  { name: "pull-rejected-cross-workspace-checkpoint", kind: "pull-response", value: { schemaVersion: 2, accepted: false, code: "SYNC_REBOOTSTRAP_REQUIRED", checkpoint: { ...clone(fixtureCheckpoint), workspaceId: "workspace-other" }, correlationId: "correlation-invalid" } },
  mutationCase("pull-mutation-unknown-field", (mutation) => { mutation.extra = true; }),
  mutationCase("pull-mutation-secret-field", (mutation) => { mutation.accessToken = "secret"; }),
  mutationCase("pull-mutation-unsafe-integer", (mutation) => { mutation.activeLeaseEpoch = Number.MAX_SAFE_INTEGER + 1; }),
  mutationCase("pull-mutation-cross-workspace", (mutation) => { mutation.workspaceId = "workspace-other"; }),
  mutationCase("pull-mutation-noncanonical-domain", (mutation) => { mutation.entityId = "Example.COM"; }),
  mutationCase("pull-mutation-changed-fields-unsorted", (mutation) => { mutation.changedFields = [{ fieldPath: "tags", value: [] }, { fieldPath: "note", value: null }]; }),
  mutationCase("pull-mutation-changed-field-unknown", (mutation) => { mutation.changedFields = [{ fieldPath: "tags", value: [], token: "secret" }]; }),
  changedFieldCase("pull-mutation-note-forbidden-control", "note", "bad\u0000note"),
  changedFieldCase("pull-mutation-portfolio-invalid-identifier", "portfolioId", "bad portfolio"),
  changedFieldCase("pull-mutation-tags-not-canonical", "tags", ["premium", "brandable"]),
  changedFieldCase("pull-mutation-target-price-not-canonical", "targetPrice", { currency: "USD", amount: "01" }),
  { name: "checkpoint-unknown-field", kind: "checkpoint-response", value: { schemaVersion: 2, checkpoint: { ...clone(fixtureCheckpoint), extra: true } } },
  { name: "checkpoint-missing", kind: "checkpoint-response", value: { schemaVersion: 2 } },
  { name: "checkpoint-cross-workspace", kind: "checkpoint-response", value: { schemaVersion: 2, checkpoint: { ...clone(fixtureCheckpoint), workspaceId: "workspace-other" } } },
  { name: "checkpoint-digest-too-long", kind: "checkpoint-response", value: { schemaVersion: 2, checkpoint: { ...clone(fixtureCheckpoint), checkpointDigest: "A".repeat(44) } } },
  { name: "checkpoint-unsafe-revision", kind: "checkpoint-response", value: { schemaVersion: 2, checkpoint: { ...clone(fixtureCheckpoint), throughServerRevision: Number.MAX_SAFE_INTEGER + 1 } } },
  { name: "projection-bad-digest-uppercase", kind: "projection-response", value: { ...clone(projectionAccepted), canonicalRequestDigest: "A".repeat(64) } },
  { name: "projection-bad-digest-length", kind: "projection-response", value: { ...clone(projectionAccepted), canonicalRequestDigest: "a".repeat(63) } },
  { name: "projection-extra-field", kind: "projection-response", value: { ...clone(projectionAccepted), provider: "cloudflare" } },
  { name: "projection-wrong-observation", kind: "projection-response", value: { ...clone(projectionAccepted), observationId: "223e4567-e89b-42d3-a456-426614174000" } },
  { name: "projection-wrong-lease", kind: "projection-response", value: { ...clone(projectionAccepted), leaseEpoch: 8 } },
  { name: "projection-wrong-source-sequence", kind: "projection-response", value: { ...clone(projectionAccepted), sourceSequence: 2 } },
  { name: "projection-wrong-request-digest", kind: "projection-response", value: { ...clone(projectionAccepted), canonicalRequestDigest: "b".repeat(64) } },
  { name: "projection-zero-observation-sequence", kind: "projection-response", value: { ...clone(projectionAccepted), observationSequence: 0 } },
];

const generatedInvalid = invalid.map(({ name, kind, value }) => ({
  name,
  kind,
  wire: JSON.stringify(value),
  schemaAccepted: schemaFor(kind).safeParse(value).success,
}));

const rawInvalid: RawCase[] = [
  { name: "duplicate-top-level-key", kind: "push-response", wire: "{\"schemaVersion\":2,\"schemaVersion\":2,\"accepted\":true,\"acknowledgements\":[],\"headServerRevision\":0}", schemaAccepted: true },
  { name: "duplicate-nested-mutation-key", kind: "pull-response", wire: JSON.stringify(pullAccepted).replace("\"schemaVersion\":2,\"mutationId\"", "\"schemaVersion\":2,\"schemaVersion\":2,\"mutationId\""), schemaAccepted: true },
  { name: "malformed-json", kind: "checkpoint-response", wire: "{\"schemaVersion\":2,\"checkpoint\":" },
  { name: "trailing-json", kind: "checkpoint-response", wire: "{\"schemaVersion\":2,\"checkpoint\":null}{}" },
  { name: "exponent-number", kind: "projection-response", wire: `{"schemaVersion":1,"accepted":true,"observationId":"${observationId}","leaseEpoch":7e0,"sourceSequence":1,"canonicalRequestDigest":"${projectionDigest}","observationSequence":1,"disposition":"current"}`, schemaAccepted: true },
];

for (const testCase of valid) {
  if (!schemaFor(testCase.kind).safeParse(testCase.value).success) {
    throw new Error(`public schema rejected native-valid case: ${testCase.name}`);
  }
}

const corpus = {
  corpusVersion: 2,
  generatedBy: "packages/protocol/scripts/generate-native-cloud-wire-corpus.ts",
  correlation: {
    workspaceId: "workspace-a",
    push: [{ mutationId: "mutation-5", deviceMutationSequence: 9 }],
    pullAfterServerRevision: 4,
    projection: {
      observationId,
      leaseEpoch: 7,
      sourceSequence: 1,
      canonicalRequestDigest: projectionDigest,
    },
  },
  valid: valid.map(({ name, kind, value }) => ({ name, kind, wire: JSON.stringify(value) })),
  invalid: [...generatedInvalid, ...rawInvalid],
};

writeFileSync(
  resolve("test-vectors/native-cloud/wire-corpus.json"),
  `${JSON.stringify(corpus, null, 2)}\n`,
  "utf8",
);
