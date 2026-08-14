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
  encodeMutationPageDigestInput,
  encodeWorkspaceEntityDigestsInput,
  mutationPageSchema,
  workspaceEntityDigestsSchema,
  type MutationPage,
  type SyncMutation,
  type WorkspaceEntityDigest,
} from "@gooddealer/protocol/workspace";
import { canonicalUtcTimestamp, identifier } from "@gooddealer/protocol/wire";

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
  readonly fromRevisionExclusive: number;
  readonly throughRevisionInclusive: number;
  readonly returnedThroughRevision: number;
  readonly nextCursor: string | null;
  readonly completed: boolean;
  readonly mutations: readonly SyncMutation[];
}

export interface BootstrapRebuildDigestSet {
  readonly targetRevision: number;
  readonly entityDigests: readonly WorkspaceEntityDigest[];
  readonly digest: string;
}

export interface BootstrapRebuildAccumulatorOptions {
  readonly sha256: Sha256Port;
  readonly workspaceId: string;
  readonly fromRevisionExclusive: number;
  readonly throughRevisionInclusive: number;
}

/** Verifies and folds one immutable, contiguous mutation-page chain. */
export class BootstrapRebuildAccumulator {
  readonly #sha256: Sha256Port;
  readonly #workspaceId: string;
  readonly #fromRevisionExclusive: number;
  readonly #throughRevisionInclusive: number;
  readonly #mutations: SyncMutation[] = [];
  #returnedThroughRevision: number;
  #nextCursor: string | null = null;
  #completed = false;

  constructor(options: BootstrapRebuildAccumulatorOptions) {
    if (options.workspaceId.length === 0) throw new TypeError("workspace id must not be empty");
    assertRevision(options.fromRevisionExclusive, "from revision");
    assertRevision(options.throughRevisionInclusive, "through revision");
    if (options.fromRevisionExclusive > options.throughRevisionInclusive) {
      throw new TypeError("rebuild revision bounds are inverted");
    }
    this.#sha256 = options.sha256;
    this.#workspaceId = options.workspaceId;
    this.#fromRevisionExclusive = options.fromRevisionExclusive;
    this.#throughRevisionInclusive = options.throughRevisionInclusive;
    this.#returnedThroughRevision = options.fromRevisionExclusive;
  }

  async appendPage(input: MutationPage): Promise<void> {
    if (this.#completed) throw new TypeError("rebuild page chain is already complete");

    const parsed = mutationPageSchema.safeParse(input);
    if (!parsed.success) throw new TypeError(`invalid mutation page: ${parsed.error.message}`);
    const page = parsed.data;
    if (page.workspaceId !== this.#workspaceId) {
      throw new TypeError("mutation page workspace does not match the rebuild workspace");
    }
    if (page.throughRevisionInclusive !== this.#throughRevisionInclusive) {
      throw new TypeError("mutation page target revision does not match the rebuild target");
    }
    if (page.fromRevisionExclusive !== this.#returnedThroughRevision) {
      throw new TypeError("mutation pages must form one contiguous revision chain");
    }

    const expectedDigest = encodeSha256Digest(
      await this.#sha256.digest(encodeMutationPageDigestInput(page)),
    );
    if (page.pageDigest !== expectedDigest) throw new TypeError("mutation page digest does not match");

    this.#mutations.push(...page.mutations);
    this.#returnedThroughRevision = page.returnedThroughRevision;
    this.#nextCursor = page.nextCursor;
    this.#completed = page.nextCursor === null;
  }

  snapshot(): BootstrapRebuildSnapshot {
    return {
      workspaceId: this.#workspaceId,
      fromRevisionExclusive: this.#fromRevisionExclusive,
      throughRevisionInclusive: this.#throughRevisionInclusive,
      returnedThroughRevision: this.#returnedThroughRevision,
      nextCursor: this.#nextCursor,
      completed: this.#completed,
      mutations: this.#mutations.map((mutation) => ({
        ...mutation,
        changedFields: mutation.changedFields.map((field) => ({ ...field })),
      })),
    };
  }

  async finalize(entityDigests: readonly WorkspaceEntityDigest[]): Promise<BootstrapRebuildDigestSet> {
    if (!this.#completed) throw new TypeError("rebuild digest requires a terminal page");
    const parsed = workspaceEntityDigestsSchema.parse(entityDigests);
    const digest = encodeSha256Digest(
      await this.#sha256.digest(encodeWorkspaceEntityDigestsInput(parsed)),
    );
    return {
      targetRevision: this.#throughRevisionInclusive,
      entityDigests: parsed.map((entry) => ({ ...entry })),
      digest,
    };
  }
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
