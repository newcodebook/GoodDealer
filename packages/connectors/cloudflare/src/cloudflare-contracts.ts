import {
  copyUntrustedCloudflareWire,
  parseCloudflareObservationSubmitRequest as parseProtocolCloudflareObservationSubmitRequest,
  type CloudflareObservationSubmitRequest,
} from "@gooddealer/protocol/connectors";

const CONTRACT_ERROR_MESSAGE = "invalid cloudflare observation data";
const MAX_IDENTIFIER_BYTES = 256;
const MAX_RETRY_AFTER_SECONDS = 86_400;
const encoder = new TextEncoder();

export interface CloudflareZoneReadIntent {
  readonly connectionId: string;
  readonly zoneId: string;
}

/** Local Host diagnostic codes. Only the five sanitized codes may enter the Host-local observation envelope. */
export type CloudflareObservationErrorCode =
  | "denied"
  | "authentication"
  | "permission"
  | "rate_limited"
  | "temporarily_unavailable"
  | "invalid_response"
  | "response_too_large";

export interface CloudflareObservationError {
  readonly code: CloudflareObservationErrorCode;
  readonly retryAfterSeconds: number | null;
}

export class CloudflareContractError extends Error {
  readonly code = "validation" as const;

  constructor() {
    super(CONTRACT_ERROR_MESSAGE);
    this.name = "CloudflareContractError";
  }
}

export function parseCloudflareZoneReadIntent(input: unknown): CloudflareZoneReadIntent {
  return parseContract(() => {
    const value = exactObject(copyUntrustedCloudflareWire(input), ["connectionId", "zoneId"]);
    return { connectionId: identifier(value.connectionId), zoneId: zoneId(value.zoneId) };
  });
}

/** Parses the sole Protocol-owned public observation envelope after hostile-input copying. */
export function parseCloudflareObservationSubmitRequest(input: unknown): CloudflareObservationSubmitRequest {
  return parseContract(() => parseProtocolCloudflareObservationSubmitRequest(input));
}

export function parseCloudflareObservationError(input: unknown): CloudflareObservationError {
  return parseContract(() => {
    const value = exactObject(copyUntrustedCloudflareWire(input), ["code", "retryAfterSeconds"]);
    const code = observationErrorCode(value.code);
    if (code === "rate_limited") {
      if (value.retryAfterSeconds === null) return { code, retryAfterSeconds: null };
      return { code, retryAfterSeconds: boundedSafeInteger(value.retryAfterSeconds, 0, MAX_RETRY_AFTER_SECONDS) };
    }
    if (value.retryAfterSeconds !== null) fail();
    return { code, retryAfterSeconds: null };
  });
}

function exactObject(input: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) fail();
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => Object.hasOwn(value, key))) fail();
  return value;
}

function identifier(input: unknown): string {
  if (typeof input !== "string" || input.length === 0 || encoder.encode(input).byteLength > MAX_IDENTIFIER_BYTES || /[\p{Cc}\p{Cf}]/u.test(input)) fail();
  return input;
}

function zoneId(input: unknown): string {
  if (typeof input !== "string" || !/^[0-9a-f]{32}$/u.test(input)) fail();
  return input;
}

function observationErrorCode(input: unknown): CloudflareObservationErrorCode {
  if (input === "denied" || input === "authentication" || input === "permission" || input === "rate_limited" ||
      input === "temporarily_unavailable" || input === "invalid_response" || input === "response_too_large") return input;
  fail();
}

function boundedSafeInteger(input: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(input) || (input as number) < minimum || (input as number) > maximum) fail();
  return input as number;
}

function parseContract<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new CloudflareContractError();
  }
}

function fail(): never {
  throw new CloudflareContractError();
}
