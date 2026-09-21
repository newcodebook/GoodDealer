import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

import {
  encodeActiveDeviceLeaseSignatureTranscript,
  encodeDesktopAuthorizationGrantSignatureTranscript,
} from "@gooddealer/protocol/devices";
import { encodeDomainSeparatedWireValue, identifier } from "@gooddealer/protocol/wire";

import {
  ACTIVE_DEVICE_LEASE_KEY_PURPOSE,
  type ActiveDeviceLeaseSigner,
} from "../modules/devices/postgres-bootstrap-activation";
import {
  DESKTOP_AUTHORIZATION_GRANT_KEY_PURPOSE,
  type DesktopAuthorizationGrantSigner,
} from "../modules/devices/authorization-grant-issuer";

export interface OpenBaoTransitSigningKey {
  readonly name: string;
  readonly version: number;
  readonly kid: string;
  /** Trusted deployment input, distributed independently from the Transit response. */
  readonly publicKeyPem: string;
}

export interface OpenBaoTransitSignerConfiguration {
  readonly address: string;
  readonly namespace?: string;
  readonly mount: string;
  readonly grantKey: OpenBaoTransitSigningKey;
  readonly leaseKey: OpenBaoTransitSigningKey;
  /** Supplies a short-lived, least-privilege OpenBao workload token for each request. */
  readonly tokenSource: OpenBaoTransitTokenSource;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
  readonly requestTimeoutMs?: number;
}

export interface OpenBaoTransitTokenSource {
  token(): Promise<string>;
  invalidate(token: string): void;
}

type GrantSigningInput = Parameters<DesktopAuthorizationGrantSigner["sign"]>[0];
type LeaseSigningInput = Parameters<ActiveDeviceLeaseSigner["sign"]>[0];
type SigningInput = GrantSigningInput | LeaseSigningInput;
type SigningResult = Awaited<ReturnType<DesktopAuthorizationGrantSigner["sign"]>>;

interface PreparedKey {
  readonly name: string;
  readonly version: number;
  readonly kid: string;
  readonly verificationKey: KeyObject;
  readonly publicKeyDer: Buffer;
}

export class OpenBaoTransitSigningError extends Error {
  constructor() {
    super("OpenBao Transit signing failed");
    this.name = "OpenBaoTransitSigningError";
  }
}

/**
 * Narrow OpenBao Transit adapter for GoodDealer authority envelopes. It has no key-management
 * capability: the workload token may sign only the two configured, purpose-separated keys.
 */
export class OpenBaoTransitSigner
implements DesktopAuthorizationGrantSigner, ActiveDeviceLeaseSigner {
  readonly #origin: string;
  readonly #namespace: string | undefined;
  readonly #mount: string;
  readonly #grantKey: PreparedKey;
  readonly #leaseKey: PreparedKey;
  readonly #tokenSource: OpenBaoTransitTokenSource;
  readonly #fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly #requestTimeoutMs: number;

  constructor(configuration: OpenBaoTransitSignerConfiguration) {
    this.#origin = parseOpenBaoOrigin(configuration.address);
    this.#namespace = parseNamespace(configuration.namespace);
    this.#mount = parsePathSegment(configuration.mount, "OpenBao Transit mount");
    this.#grantKey = prepareKey(configuration.grantKey);
    this.#leaseKey = prepareKey(configuration.leaseKey);
    if (this.#grantKey.name === this.#leaseKey.name
      || this.#grantKey.kid === this.#leaseKey.kid
      || this.#grantKey.publicKeyDer.equals(this.#leaseKey.publicKeyDer)) {
      throw new TypeError("OpenBao Grant and Lease keys must be purpose-separated");
    }
    this.#tokenSource = configuration.tokenSource;
    this.#fetch = configuration.fetch ?? fetch;
    this.#requestTimeoutMs = configuration.requestTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs < 100 || this.#requestTimeoutMs > 30_000) {
      throw new TypeError("OpenBao request timeout is invalid");
    }
  }

  async sign(input: SigningInput): Promise<SigningResult> {
    try {
      const selected = selectPurpose(input, this.#grantKey, this.#leaseKey);
      const unsignedEnvelope = {
        ...input.claims,
        kid: selected.key.kid,
        signature: Buffer.alloc(64).toString("base64url"),
      };
      const transcript = selected.transcript(unsignedEnvelope);
      let token = await this.#tokenSource.token();
      let response = await this.#requestSignature(selected.key, transcript, token);
      if (response.status === 401 || response.status === 403) {
        await cancelResponseBody(response);
        this.#tokenSource.invalidate(token);
        token = await this.#tokenSource.token();
        response = await this.#requestSignature(selected.key, transcript, token);
      }
      if (!response.ok) {
        await cancelResponseBody(response);
        throw new OpenBaoTransitSigningError();
      }
      const providerResponse = await readOpenBaoResponse(response);
      const signature = parseTransitSignature(providerResponse.signature, selected.key.version);
      const envelope = { ...unsignedEnvelope, signature: signature.toString("base64url") };
      if (!verify(null, transcript, selected.key.verificationKey, signature)) {
        throw new OpenBaoTransitSigningError();
      }
      const receipt = encodeDomainSeparatedWireValue(
        "GOODDEALER-OPENBAO-TRANSIT-SIGNING-RECEIPT-V1",
        {
          requestId: providerResponse.requestId,
          purpose: input.purpose,
          keyName: selected.key.name,
          keyVersion: selected.key.version,
          kid: selected.key.kid,
          transcriptDigest: createHash("sha256").update(transcript).digest("hex"),
          signatureDigest: createHash("sha256").update(signature).digest("hex"),
        },
      );
      return {
        signed: true,
        envelope,
        verificationKey: selected.key.verificationKey,
        receipt,
      };
    } catch (error) {
      if (error instanceof OpenBaoTransitSigningError) throw error;
      throw new OpenBaoTransitSigningError();
    }
  }

  async #requestSignature(
    key: PreparedKey,
    transcript: Uint8Array,
    token: string,
  ): Promise<Response> {
    assertToken(token);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-vault-token": token,
    };
    if (this.#namespace !== undefined) headers["x-vault-namespace"] = this.#namespace;
    return this.#fetch(
      `${this.#origin}/v1/${encodeURIComponent(this.#mount)}/sign/${encodeURIComponent(key.name)}`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
        headers,
        body: JSON.stringify({
          input: Buffer.from(transcript).toString("base64"),
          key_version: key.version,
          prehashed: false,
        }),
      },
    );
  }
}

function selectPurpose(input: SigningInput, grantKey: PreparedKey, leaseKey: PreparedKey): {
  readonly key: PreparedKey;
  readonly transcript: (value: unknown) => Uint8Array;
} {
  if (input.purpose === DESKTOP_AUTHORIZATION_GRANT_KEY_PURPOSE) {
    return { key: grantKey, transcript: encodeDesktopAuthorizationGrantSignatureTranscript };
  }
  if (input.purpose === ACTIVE_DEVICE_LEASE_KEY_PURPOSE) {
    return { key: leaseKey, transcript: encodeActiveDeviceLeaseSignatureTranscript };
  }
  throw new OpenBaoTransitSigningError();
}

function parseOpenBaoOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("OpenBao address is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" ||
    parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new TypeError("OpenBao address must be an HTTPS origin");
  }
  return parsed.origin;
}

function parseNamespace(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length < 1 || value.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value) ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new TypeError("OpenBao namespace is invalid");
  }
  return value;
}

function parsePathSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function prepareKey(value: OpenBaoTransitSigningKey): PreparedKey {
  const name = parsePathSegment(value.name, "OpenBao Transit key name");
  const kid = identifier.parse(value.kid);
  if (!Number.isSafeInteger(value.version) || value.version < 1) {
    throw new TypeError("OpenBao Transit key version is invalid");
  }
  let verificationKey: KeyObject;
  try {
    verificationKey = createPublicKey(value.publicKeyPem);
  } catch {
    throw new TypeError("OpenBao Transit public key is invalid");
  }
  if (verificationKey.type !== "public" || verificationKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("OpenBao Transit public key must be Ed25519");
  }
  const publicKeyDer = Buffer.from(verificationKey.export({ format: "der", type: "spki" }));
  return { name, version: value.version, kid, verificationKey, publicKeyDer };
}

function assertToken(value: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 8_192 ||
    /[\u0000-\u0020\u007f]/u.test(value)) {
    throw new OpenBaoTransitSigningError();
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Signing failures stay generic even when a broken transport also refuses cancellation.
  }
}

async function readOpenBaoResponse(response: Response): Promise<{
  readonly requestId: string;
  readonly signature: string;
}> {
  const maximumBytes = 32_768;
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    await cancelResponseBody(response);
    throw new OpenBaoTransitSigningError();
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
    await cancelResponseBody(response);
    throw new OpenBaoTransitSigningError();
  }
  if (response.body === null) throw new OpenBaoTransitSigningError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new OpenBaoTransitSigningError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new OpenBaoTransitSigningError();
  }
  const root = plainRecord(decoded);
  const data = plainRecord(root.data);
  if (typeof root.request_id !== "string" || root.request_id.length < 1 ||
    root.request_id.length > 256 || /[\u0000-\u001f\u007f]/u.test(root.request_id) ||
    typeof data.signature !== "string") {
    throw new OpenBaoTransitSigningError();
  }
  return { requestId: root.request_id, signature: data.signature };
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    throw new OpenBaoTransitSigningError();
  }
  return value as Record<string, unknown>;
}

function parseTransitSignature(value: string, expectedVersion: number): Buffer {
  const matched = /^vault:v([1-9]\d*):([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (matched === null || Number(matched[1]) !== expectedVersion) {
    throw new OpenBaoTransitSigningError();
  }
  const encoded = matched[2]!;
  const signature = Buffer.from(encoded, "base64");
  if (signature.byteLength !== 64 || signature.toString("base64") !== encoded) {
    throw new OpenBaoTransitSigningError();
  }
  return signature;
}
