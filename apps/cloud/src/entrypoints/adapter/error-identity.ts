import type { FastifyReply, FastifyRequest } from "fastify";

import {
  ACCOUNT_REJECTION_SCHEMA_VERSION,
  accountRejectionSchema,
  type AccountRejection,
  type AccountRejectionCode,
} from "@gooddealer/protocol/account";
import {
  TRANSPORT_REJECTION_SCHEMA_VERSION,
  type TransportRejection,
  type TransportRejectionCode,
} from "@gooddealer/protocol/wire";

import { correlationIdFor } from "./correlation";

export type RejectionHttpStatus = 400 | 401 | 403 | 404 | 405 | 409 | 413 | 415 | 429 | 500;

export const ACCOUNT_REJECTION_STATUS = {
  INVALID_CREDENTIALS: 401,
  RATE_LIMITED: 429,
  EMAIL_VERIFICATION_REQUIRED: 403,
  REAUTHENTICATION_REQUIRED: 403,
  REAUTH_PROOF_EXPIRED: 403,
  ACCOUNT_SECURITY_EPOCH_STALE: 409,
  ACCOUNT_RECOVERY_PENDING: 409,
  SESSION_REVOKED: 401,
  REFRESH_REUSE_DETECTED: 401,
  REFRESH_ROTATION_CONFLICT: 409,
  DEVICE_NOT_BOUND: 403,
  DEVICE_REMOVED: 403,
  DEVICE_LIMIT_REACHED: 409,
  ACTIVE_DEVICE_CONFLICT: 409,
  EXCLUSIVE_EXECUTION_BLOCKED: 409,
  ENTITLEMENT_INACTIVE: 403,
  ENTITLEMENT_REVISION_STALE: 409,
  LIST_REVISION_STALE: 409,
  TRUSTED_TIME_ROLLBACK: 409,
  UNSUPPORTED_SCHEMA_VERSION: 400,
} as const satisfies Record<AccountRejectionCode, RejectionHttpStatus>;

export function accountRejectionStatus(code: AccountRejectionCode): RejectionHttpStatus {
  return ACCOUNT_REJECTION_STATUS[code];
}

export function transportRejection(
  code: TransportRejectionCode,
  correlationId: string,
): TransportRejection {
  return {
    schemaVersion: TRANSPORT_REJECTION_SCHEMA_VERSION,
    code,
    correlationId,
  };
}

export function sendTransportRejection(
  request: FastifyRequest,
  reply: FastifyReply,
  status: RejectionHttpStatus,
  code: TransportRejectionCode,
): FastifyReply {
  return reply.status(status).send(transportRejection(code, correlationIdFor(request)));
}

export function sendNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendTransportRejection(request, reply, 404, "NOT_FOUND");
}

export function sendAccountRejection(reply: FastifyReply, rejection: AccountRejection): FastifyReply {
  const parsed = accountRejectionSchema.parse(rejection);
  const status = accountRejectionStatus(parsed.code);
  if (status === 429) {
    reply.header("retry-after", String(parsed.retryAfterSeconds));
  }
  return reply.status(status).send(parsed);
}

export function rateLimitedRejection(correlationId: string, retryAfterSeconds: number): AccountRejection {
  return accountRejectionSchema.parse({
    schemaVersion: ACCOUNT_REJECTION_SCHEMA_VERSION,
    code: "RATE_LIMITED",
    retryable: true,
    retryAfterSeconds,
    correlationId,
  });
}
