import {
  BOOTSTRAP_STEP_SCHEMA_VERSION,
  bootstrapStepRequestSchema,
  encodeBootstrapStepRequestDigestInput,
  type BootstrapStepRequest,
} from "@gooddealer/protocol/devices";
import {
  DRAIN_PROOF_SCHEMA_VERSION,
  DRAIN_STREAMS,
  DRAIN_STREAM_GENESIS_DIGEST,
  encodeDrainChainStepInput,
  type DrainProof,
  type DrainStream,
} from "@gooddealer/protocol/execution-events";
import {
  checkpointDescriptorSchema,
  compareUtf8,
  computeDomainAssetEntityDigests,
  domainAssetProjectionSchema,
  encodeMutationPageDigestInput,
  encodeWorkspaceEntityDigestsInput,
  mutationCursorSchema,
  mutationPageSchema,
  serverRevisionSchema,
  type DomainAssetProjectionRow,
  type SyncMutation,
  type WorkspaceEntityDigest,
} from "@gooddealer/protocol/workspace";
import { canonicalUtcTimestamp, identifier, safePositiveInteger } from "@gooddealer/protocol/wire";
import { z } from "zod";

export * from "./conflict-center";
export * from "./presentation-models";

const ZERO_DIGEST = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const BASE64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export interface Sha256Port {
  digest(bytes: Uint8Array): Promise<Uint8Array>;
}

export interface DrainStreamState {
  readonly stream: DrainStream;
  readonly lastAssignedSequence: number;
  readonly contiguousReceivedThrough: number;
  readonly pendingCount: number;
  readonly rollingDigest: string;
}

/** Folds already-committed envelopes and cumulative Cloud acknowledgements. */
export class DrainStreamLedger {
  readonly #sha256: Sha256Port;
  readonly #stream: DrainStream;
  #lastAssignedSequence = 0;
  #contiguousReceivedThrough = 0;
  #rollingDigestBytes = decodeSha256Digest(DRAIN_STREAM_GENESIS_DIGEST);
  #rollingDigest: string = DRAIN_STREAM_GENESIS_DIGEST;
  #appendInFlight = false;

  constructor(deps: { readonly sha256: Sha256Port; readonly stream: DrainStream }) {
    if (!DRAIN_STREAMS.some((stream) => stream === deps.stream)) {
      throw new TypeError("unknown drain stream");
    }
    this.#sha256 = deps.sha256;
    this.#stream = deps.stream;
  }

  async appendCommitted(sequence: number, envelope: Uint8Array): Promise<void> {
    assertSafePositiveInteger(sequence, "drain sequence");
    if (!(envelope instanceof Uint8Array)) {
      throw new TypeError("drain envelope must be bytes");
    }
    if (this.#appendInFlight) {
      throw new TypeError("a drain append is already in progress");
    }
    if (sequence <= this.#lastAssignedSequence) {
      throw new TypeError("a committed drain sequence cannot be rewritten");
    }
    if (sequence !== this.#lastAssignedSequence + 1) {
      throw new TypeError("a committed drain sequence must be the next contiguous sequence; gaps are refused");
    }

    this.#appendInFlight = true;
    try {
      const nextDigestBytes = await this.#sha256.digest(
        encodeDrainChainStepInput(this.#rollingDigestBytes, envelope),
      );
      const nextDigest = encodeSha256Digest(nextDigestBytes);
      this.#rollingDigestBytes = new Uint8Array(nextDigestBytes);
      this.#rollingDigest = nextDigest;
      this.#lastAssignedSequence = sequence;
    } finally {
      this.#appendInFlight = false;
    }
  }

  acknowledgeThrough(sequence: number): void {
    assertSafeUnsignedInteger(sequence, "acknowledged drain sequence");
    if (sequence < this.#contiguousReceivedThrough) {
      throw new TypeError("drain acknowledgements must be monotone");
    }
    if (sequence > this.#lastAssignedSequence) {
      throw new TypeError("a drain acknowledgement cannot exceed the last committed sequence");
    }
    this.#contiguousReceivedThrough = sequence;
  }

  state(): DrainStreamState {
    return {
      stream: this.#stream,
      lastAssignedSequence: this.#lastAssignedSequence,
      contiguousReceivedThrough: this.#contiguousReceivedThrough,
      pendingCount: this.#lastAssignedSequence - this.#contiguousReceivedThrough,
      rollingDigest: this.#rollingDigest,
    };
  }
}

type DrainProofHostField =
  | "proofId"
  | "signingKeyId"
  | "signingKeyVersion"
  | "signatureTranscriptVersion"
  | "deviceSignature";

type WithoutDrainProofHostFields<Proof extends DrainProof> = Proof extends DrainProof
  ? Omit<Proof, DrainProofHostField>
  : never;

/** Claims awaiting Host-owned proof identity, key binding, transcript version, and signature. */
export type UnsignedDrainProof = WithoutDrainProofHostFields<DrainProof>;

export interface BuildDrainProofClaimsInput {
  readonly purpose: "handoff" | "synchronized_backup";
  readonly workspaceId: string;
  readonly sourceDeviceId: string;
  readonly activeLeaseEpoch: number;
  readonly deviceSwitchRequestId?: string;
  readonly synchronizedSnapshotBinding?: {
    readonly localCommitSequence: number;
    readonly serverRevision: number;
  };
  readonly streams: readonly [DrainStreamState, DrainStreamState, DrainStreamState];
  /** Supplied by the Host's trusted-time boundary; client-core does not interpret it. */
  readonly issuedAt: string;
  /** Supplied by the Host's trusted-time boundary; client-core does not interpret it. */
  readonly expiresAt: string;
}

/** Assembles local ledger facts only; proof identity and signing remain Host-owned. */
export function buildDrainProofClaims(input: BuildDrainProofClaimsInput): UnsignedDrainProof {
  assertNonemptyString(input.workspaceId, "workspace id");
  assertNonemptyString(input.sourceDeviceId, "source device id");
  assertSafePositiveInteger(input.activeLeaseEpoch, "active lease epoch");
  assertNonemptyString(input.issuedAt, "issued timestamp");
  assertNonemptyString(input.expiresAt, "expiry timestamp");

  const readiness = projectDrainReadiness(input.streams);
  if (readiness === "blocked") {
    throw new TypeError("proof claims require the valid drain stream order and internally consistent states");
  }
  if (readiness === "flushing") {
    throw new TypeError("proof claims require every drain stream to be fully acknowledged");
  }

  const streams: DrainProof["streams"] = [
    copyDrainStreamState(input.streams[0], "mutation"),
    copyDrainStreamState(input.streams[1], "execution_fact"),
    copyDrainStreamState(input.streams[2], "device_audit"),
  ];
  const common = {
    schemaVersion: DRAIN_PROOF_SCHEMA_VERSION,
    typ: "gd.drain-proof.v1" as const,
    aud: "gooddealer-cloud/drain-verification" as const,
    workspaceId: input.workspaceId,
    sourceDeviceId: input.sourceDeviceId,
    activeLeaseEpoch: input.activeLeaseEpoch,
    streams,
    canonicalCodecVersion: 1 as const,
    digestAlgorithm: "sha256-chain-v1" as const,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  };

  if (input.purpose === "handoff") {
    assertNonemptyString(input.deviceSwitchRequestId, "device switch request id");
    if (input.synchronizedSnapshotBinding !== undefined) {
      throw new TypeError("handoff proof claims must not carry a synchronized snapshot binding");
    }
    return validateDrainProofClaimScalars({
      ...common,
      purpose: "handoff",
      deviceSwitchRequestId: input.deviceSwitchRequestId,
    });
  }

  if (input.deviceSwitchRequestId !== undefined) {
    throw new TypeError("synchronized-backup proof claims must not carry a device switch request id");
  }
  if (input.synchronizedSnapshotBinding === undefined) {
    throw new TypeError("synchronized-backup proof claims require a synchronized snapshot binding");
  }
  assertSafeUnsignedInteger(
    input.synchronizedSnapshotBinding.localCommitSequence,
    "local commit sequence",
  );
  assertSafeUnsignedInteger(
    input.synchronizedSnapshotBinding.serverRevision,
    "snapshot server revision",
  );
  return validateDrainProofClaimScalars({
    ...common,
    purpose: "synchronized_backup",
    synchronizedSnapshotBinding: { ...input.synchronizedSnapshotBinding },
  });
}

export type DrainReadiness = "not_started" | "flushing" | "ready_to_sign" | "blocked";

/** Projects upload readiness without interpreting authority, eligibility, or time. */
export function projectDrainReadiness(streams: readonly DrainStreamState[]): DrainReadiness {
  if (streams.length !== DRAIN_STREAMS.length) return "blocked";

  const progress: Array<"empty" | "pending" | "complete"> = [];
  for (let index = 0; index < DRAIN_STREAMS.length; index += 1) {
    const stream = streams[index];
    if (stream === undefined || stream.stream !== DRAIN_STREAMS[index]) return "blocked";
    const classified = classifyDrainStreamState(stream);
    if (classified === "blocked") return "blocked";
    progress.push(classified);
  }

  if (progress.every((entry) => entry === "empty")) return "not_started";
  if (progress.some((entry) => entry === "pending")) return "flushing";
  return "ready_to_sign";
}

type StepKind = BootstrapStepRequest["stepKind"];
type StepRequest<Kind extends StepKind> = Extract<BootstrapStepRequest, { stepKind: Kind }>;
type StepInput<Kind extends StepKind> = Omit<StepRequest<Kind>, "stepKind" | "requestDigest">;

export type PinInput = StepInput<"pin_checkpoint">;
export type FetchInput = StepInput<"fetch_mutations">;
export type SubmitInput = StepInput<"submit_rebuild_digest">;

/** Builds canonical strict-step requests without depending on a host crypto runtime. */
export class BootstrapStepPlanner {
  readonly #sha256: Sha256Port;

  constructor(deps: { readonly sha256: Sha256Port }) {
    this.#sha256 = deps.sha256;
  }

  planPinCheckpoint(input: PinInput): Promise<BootstrapStepRequest> {
    return this.#plan("pin_checkpoint", input);
  }

  planFetchMutations(input: FetchInput): Promise<BootstrapStepRequest> {
    return this.#plan("fetch_mutations", input);
  }

  planSubmitRebuildDigest(input: SubmitInput): Promise<BootstrapStepRequest> {
    return this.#plan("submit_rebuild_digest", input);
  }

  async #plan<Kind extends StepKind>(kind: Kind, input: StepInput<Kind>): Promise<BootstrapStepRequest> {
    const draft = bootstrapStepRequestSchema.parse({
      ...input,
      schemaVersion: BOOTSTRAP_STEP_SCHEMA_VERSION,
      stepKind: kind,
      requestDigest: ZERO_DIGEST,
    });
    const requestDigest = encodeSha256Digest(
      await this.#sha256.digest(encodeBootstrapStepRequestDigestInput(draft)),
    );
    return bootstrapStepRequestSchema.parse({ ...draft, requestDigest });
  }
}

export interface BootstrapRebuildSnapshot {
  readonly workspaceId: string;
  readonly workspaceSchemaVersion: number;
  readonly fromServerRevisionExclusive: number;
  readonly throughServerRevisionInclusive: number;
  readonly returnedThroughServerRevision: number;
  readonly nextCursor: string | null;
  readonly completed: boolean;
  readonly projection: readonly DomainAssetProjectionRow[];
}

export interface BootstrapRebuildDigestSet {
  readonly targetServerRevision: number;
  readonly projection: readonly DomainAssetProjectionRow[];
  readonly entityDigests: readonly WorkspaceEntityDigest[];
  readonly digest: string;
}

const bootstrapCheckpointSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: identifier,
    workspaceSchemaVersion: safePositiveInteger,
    throughServerRevision: serverRevisionSchema,
    rows: domainAssetProjectionSchema,
  })
  .strict();

export interface BootstrapRebuildAccumulatorOptions {
  readonly sha256: Sha256Port;
  readonly workspaceId: string;
  readonly workspaceSchemaVersion: number;
  readonly targetServerRevision: number;
  readonly checkpointDescriptor: unknown;
  readonly checkpointSnapshot: unknown;
}

export interface BootstrapMutationPagePresentation {
  readonly cursor: string | null;
  readonly page: unknown;
}

type MutableDomainAsset = {
  entityId: string;
  note: string | null;
  portfolioId: string | null;
  tags: string[];
  targetPrice: { currency: string; amount: string } | null;
};

/** Derives one projection exclusively from a verified checkpoint and dense mutation pages. */
export class BootstrapRebuildAccumulator {
  readonly #sha256: Sha256Port;
  readonly #workspaceId: string;
  readonly #workspaceSchemaVersion: number;
  readonly #fromServerRevisionExclusive: number;
  readonly #throughServerRevisionInclusive: number;
  #projection: Map<string, MutableDomainAsset>;
  #mutationIds = new Set<string>();
  #returnedThroughServerRevision: number;
  #nextCursor: string | null = null;
  #completed = false;
  #appendInFlight = false;

  private constructor(input: {
    readonly sha256: Sha256Port;
    readonly workspaceId: string;
    readonly workspaceSchemaVersion: number;
    readonly fromServerRevisionExclusive: number;
    readonly throughServerRevisionInclusive: number;
    readonly projection: Map<string, MutableDomainAsset>;
  }) {
    this.#sha256 = input.sha256;
    this.#workspaceId = input.workspaceId;
    this.#workspaceSchemaVersion = input.workspaceSchemaVersion;
    this.#fromServerRevisionExclusive = input.fromServerRevisionExclusive;
    this.#throughServerRevisionInclusive = input.throughServerRevisionInclusive;
    this.#returnedThroughServerRevision = input.fromServerRevisionExclusive;
    this.#projection = input.projection;
  }

  static async start(options: BootstrapRebuildAccumulatorOptions): Promise<BootstrapRebuildAccumulator> {
    const workspaceId = identifier.parse(options.workspaceId);
    const workspaceSchemaVersion = safePositiveInteger.parse(options.workspaceSchemaVersion);
    const targetServerRevision = serverRevisionSchema.parse(options.targetServerRevision);
    const descriptor = checkpointDescriptorSchema.parse(copyStrictWireValue(options.checkpointDescriptor));
    const snapshot = bootstrapCheckpointSnapshotSchema.parse(copyStrictWireValue(options.checkpointSnapshot));
    if (
      descriptor.workspaceId !== workspaceId ||
      snapshot.workspaceId !== workspaceId ||
      descriptor.workspaceSchemaVersion !== workspaceSchemaVersion ||
      snapshot.workspaceSchemaVersion !== workspaceSchemaVersion ||
      descriptor.throughServerRevision !== snapshot.throughServerRevision ||
      targetServerRevision < descriptor.throughServerRevision
    ) {
      throw new TypeError("checkpoint snapshot, descriptor, and rebuild binding do not match");
    }
    const entityDigests = await computeDomainAssetEntityDigests(
      snapshot.rows,
      options.sha256.digest.bind(options.sha256),
    );
    const checkpointDigest = encodeSha256Digest(
      await options.sha256.digest(encodeWorkspaceEntityDigestsInput(entityDigests)),
    );
    if (checkpointDigest !== descriptor.checkpointDigest) {
      throw new TypeError("checkpoint snapshot digest does not match its descriptor");
    }
    return new BootstrapRebuildAccumulator({
      sha256: options.sha256,
      workspaceId,
      workspaceSchemaVersion,
      fromServerRevisionExclusive: descriptor.throughServerRevision,
      throughServerRevisionInclusive: targetServerRevision,
      projection: new Map(snapshot.rows.map((row) => [row.entityId, cloneDomainAsset(row)])),
    });
  }

  async appendPage(input: BootstrapMutationPagePresentation): Promise<void> {
    if (this.#completed) throw new TypeError("rebuild page chain is already complete");
    if (this.#appendInFlight) throw new TypeError("a rebuild page append is already in progress");
    const presentation = z
      .object({ cursor: mutationCursorSchema.nullable(), page: mutationPageSchema })
      .strict()
      .parse(copyStrictWireValue(input));
    if (presentation.cursor !== this.#nextCursor) {
      throw new TypeError("mutation page cursor does not match the expected continuation");
    }
    const page = presentation.page;
    if (page.workspaceId !== this.#workspaceId) {
      throw new TypeError("mutation page workspace does not match the rebuild workspace");
    }
    if (page.throughServerRevisionInclusive !== this.#throughServerRevisionInclusive) {
      throw new TypeError("mutation page target revision does not match the rebuild target");
    }
    if (page.fromServerRevisionExclusive !== this.#returnedThroughServerRevision) {
      throw new TypeError("mutation pages must form one contiguous revision chain");
    }
    if (page.mutations.some((mutation) => mutation.workspaceSchemaVersion !== this.#workspaceSchemaVersion)) {
      throw new TypeError("mutation workspace schema does not match the frozen checkpoint schema");
    }

    this.#appendInFlight = true;
    try {
      const expectedDigest = encodeSha256Digest(
        await this.#sha256.digest(encodeMutationPageDigestInput(page)),
      );
      if (page.pageDigest !== expectedDigest) throw new TypeError("mutation page digest does not match");

      const projection = cloneProjection(this.#projection);
      const mutationIds = new Set(this.#mutationIds);
      for (const mutation of page.mutations) {
        if (mutationIds.has(mutation.mutationId)) {
          throw new TypeError("rebuild mutation identity is duplicated");
        }
        mutationIds.add(mutation.mutationId);
        applyDomainAssetMutation(projection, mutation);
      }
      domainAssetProjectionSchema.parse(canonicalProjection(projection));
      this.#projection = projection;
      this.#mutationIds = mutationIds;
      this.#returnedThroughServerRevision = page.returnedThroughServerRevision;
      this.#nextCursor = page.nextCursor;
      this.#completed = page.nextCursor === null;
    } finally {
      this.#appendInFlight = false;
    }
  }

  snapshot(): BootstrapRebuildSnapshot {
    return {
      workspaceId: this.#workspaceId,
      workspaceSchemaVersion: this.#workspaceSchemaVersion,
      fromServerRevisionExclusive: this.#fromServerRevisionExclusive,
      throughServerRevisionInclusive: this.#throughServerRevisionInclusive,
      returnedThroughServerRevision: this.#returnedThroughServerRevision,
      nextCursor: this.#nextCursor,
      completed: this.#completed,
      projection: canonicalProjection(this.#projection),
    };
  }

  async finalize(): Promise<BootstrapRebuildDigestSet> {
    if (!this.#completed) throw new TypeError("rebuild digest requires a terminal page");
    const projection = canonicalProjection(this.#projection);
    const entityDigests = await computeDomainAssetEntityDigests(
      projection,
      this.#sha256.digest.bind(this.#sha256),
    );
    const digest = encodeSha256Digest(
      await this.#sha256.digest(encodeWorkspaceEntityDigestsInput(entityDigests)),
    );
    return {
      targetServerRevision: this.#throughServerRevisionInclusive,
      projection,
      entityDigests: entityDigests.map((entry) => ({ ...entry })),
      digest,
    };
  }
}

function cloneDomainAsset(row: DomainAssetProjectionRow): MutableDomainAsset {
  return {
    entityId: row.entityId,
    note: row.note,
    portfolioId: row.portfolioId,
    tags: [...row.tags],
    targetPrice: row.targetPrice === null ? null : { ...row.targetPrice },
  };
}

function cloneProjection(input: Map<string, MutableDomainAsset>): Map<string, MutableDomainAsset> {
  return new Map([...input].map(([entityId, row]) => [entityId, cloneDomainAsset(row)]));
}

function canonicalProjection(input: Map<string, MutableDomainAsset>): DomainAssetProjectionRow[] {
  return [...input.values()]
    .sort((left, right) => compareUtf8(left.entityId, right.entityId))
    .map(cloneDomainAsset);
}

function applyDomainAssetMutation(projection: Map<string, MutableDomainAsset>, mutation: SyncMutation): void {
  const row = projection.get(mutation.entityId);
  if (row === undefined) throw new TypeError("rebuild mutation references an unknown entity");
  for (const field of mutation.changedFields) {
    switch (field.fieldPath) {
      case "note": row.note = field.value; break;
      case "portfolioId": row.portfolioId = field.value; break;
      case "tags": row.tags = [...field.value]; break;
      case "targetPrice": row.targetPrice = field.value === null ? null : { ...field.value }; break;
    }
  }
}

function copyStrictWireValue(value: unknown): unknown {
  const budget = { properties: 0, bytes: 0 };
  return copyStrictWireNode(value, budget, 0);
}

function copyStrictWireNode(
  value: unknown,
  budget: { properties: number; bytes: number },
  depth: number,
): unknown {
  if (depth > 16 || budget.properties > 8_192 || budget.bytes > 2_000_000) {
    throw new TypeError("rebuild wire value exceeds its structural budget");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("rebuild wire number is unsafe");
    return value;
  }
  if (typeof value === "string") {
    budget.bytes += new TextEncoder().encode(value).byteLength;
    if (budget.bytes > 2_000_000 || value.length > 100_000) {
      throw new TypeError("rebuild wire string exceeds its budget");
    }
    return value;
  }
  if (typeof value !== "object") throw new TypeError("rebuild wire value has an invalid type");

  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || value.length > 8_192) {
      throw new TypeError("rebuild wire array is malformed");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)))) {
      throw new TypeError("rebuild wire array has non-index properties");
    }
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("rebuild wire array is sparse or uses accessors");
      }
      budget.properties += 1;
      return copyStrictWireNode(descriptor.value, budget, depth + 1);
    });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("rebuild wire object has a custom prototype");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new TypeError("rebuild wire object has symbol properties");
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("rebuild wire object uses accessors or hidden properties");
    }
    budget.properties += 1;
    result[key] = copyStrictWireNode(descriptor.value, budget, depth + 1);
  }
  return result;
}

function assertRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a safe unsigned integer`);
}

function assertSafeUnsignedInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a safe unsigned integer`);
  }
}

function assertSafePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a safe positive integer`);
  }
}

function assertNonemptyString(value: string | undefined, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
}

/** Validates protocol scalar shapes only; proof-window ordering remains a Host/Cloud concern. */
function validateDrainProofClaimScalars<Claims extends UnsignedDrainProof>(claims: Claims): Claims {
  identifier.parse(claims.workspaceId);
  identifier.parse(claims.sourceDeviceId);
  canonicalUtcTimestamp.parse(claims.issuedAt);
  canonicalUtcTimestamp.parse(claims.expiresAt);
  if (claims.purpose === "handoff") identifier.parse(claims.deviceSwitchRequestId);
  return claims;
}

function classifyDrainStreamState(
  state: DrainStreamState,
): "empty" | "pending" | "complete" | "blocked" {
  if (
    !Number.isSafeInteger(state.lastAssignedSequence) ||
    state.lastAssignedSequence < 0 ||
    !Number.isSafeInteger(state.contiguousReceivedThrough) ||
    state.contiguousReceivedThrough < 0 ||
    !Number.isSafeInteger(state.pendingCount) ||
    state.pendingCount < 0 ||
    !/^[A-Za-z0-9_-]{43}$/.test(state.rollingDigest) ||
    state.contiguousReceivedThrough > state.lastAssignedSequence ||
    state.pendingCount !== state.lastAssignedSequence - state.contiguousReceivedThrough
  ) {
    return "blocked";
  }
  if (state.lastAssignedSequence === 0) {
    return state.contiguousReceivedThrough === 0 &&
      state.pendingCount === 0 &&
      state.rollingDigest === DRAIN_STREAM_GENESIS_DIGEST
      ? "empty"
      : "blocked";
  }
  return state.pendingCount === 0 ? "complete" : "pending";
}

function copyDrainStreamState<Stream extends DrainStream>(
  state: DrainStreamState,
  expectedStream: Stream,
): DrainStreamState & { readonly stream: Stream } {
  if (state.stream !== expectedStream) {
    throw new TypeError("drain stream state is out of order");
  }
  return { ...state, stream: expectedStream };
}

function decodeSha256Digest(value: string): Uint8Array {
  let buffer = 0;
  let bufferedBits = 0;
  const decoded: number[] = [];

  for (const character of value) {
    const digit = BASE64_URL_ALPHABET.indexOf(character);
    if (digit < 0) throw new TypeError("SHA-256 digest must be unpadded base64url");
    buffer = (buffer << 6) | digit;
    bufferedBits += 6;
    if (bufferedBits >= 8) {
      bufferedBits -= 8;
      decoded.push((buffer >> bufferedBits) & 0xff);
    }
  }

  const bytes = Uint8Array.from(decoded);
  if (bytes.byteLength !== 32) {
    throw new TypeError("SHA-256 digest must decode to exactly 32 bytes");
  }
  return bytes;
}

function encodeSha256Digest(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
    throw new TypeError("SHA-256 digest port must return exactly 32 bytes");
  }

  let encoded = "";
  for (let index = 0; index < bytes.byteLength; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += BASE64_URL_ALPHABET[first >> 2]!;
    encoded += BASE64_URL_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)]!;
    if (second !== undefined) {
      encoded += BASE64_URL_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)]!;
    }
    if (third !== undefined) encoded += BASE64_URL_ALPHABET[third & 0x3f]!;
  }
  return encoded;
}
