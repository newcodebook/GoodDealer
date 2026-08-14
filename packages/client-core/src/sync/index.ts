import {
  BOOTSTRAP_STEP_SCHEMA_VERSION,
  bootstrapStepRequestSchema,
  encodeBootstrapStepRequestDigestInput,
  type BootstrapStepRequest,
} from "@gooddealer/protocol/devices";
import {
  encodeMutationPageDigestInput,
  encodeWorkspaceEntityDigestsInput,
  mutationPageSchema,
  workspaceEntityDigestsSchema,
  type MutationPage,
  type SyncMutation,
  type WorkspaceEntityDigest,
} from "@gooddealer/protocol/workspace";

const ZERO_DIGEST = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const BASE64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export interface Sha256Port {
  digest(bytes: Uint8Array): Promise<Uint8Array>;
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
