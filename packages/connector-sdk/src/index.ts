export interface ConnectorRegistration {
  readonly id: "spaceship" | "cloudflare" | "atom" | "afternic";
  readonly implementation: "fixture";
}

export {
  ENDPOINT_MANIFEST_SCHEMA_VERSION,
  ENDPOINT_MANIFEST_SHA256,
} from "./generated/endpoint-registry";
export type { EndpointId, EndpointRequest, EndpointResponse } from "./generated/endpoint-registry";
