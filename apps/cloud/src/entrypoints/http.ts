import Fastify from "fastify";

export function createPublicHttp() {
  return Fastify({ logger: false });
}
