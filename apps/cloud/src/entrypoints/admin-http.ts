import Fastify from "fastify";

export function createAdminHttp() {
  return Fastify({ logger: false });
}
