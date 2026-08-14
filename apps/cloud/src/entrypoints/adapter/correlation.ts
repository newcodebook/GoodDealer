import { randomUUID } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

const requestCorrelationIds = new WeakMap<FastifyRequest, string>();

export const CORRELATION_ID_HEADER = "x-gd-correlation-id" as const;

export function createCorrelationId(): string {
  return randomUUID();
}

export function assignCorrelationId(
  request: FastifyRequest,
  reply: FastifyReply,
  generate: () => string,
): string {
  const correlationId = generate();
  requestCorrelationIds.set(request, correlationId);
  reply.header(CORRELATION_ID_HEADER, correlationId);
  return correlationId;
}
export function correlationIdFor(request: FastifyRequest): string {
  const correlationId = requestCorrelationIds.get(request);
  if (correlationId === undefined) {
    throw new Error("correlation id was not assigned before request handling");
  }
  return correlationId;
}
