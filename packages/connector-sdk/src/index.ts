export interface ConnectorRegistration {
  readonly id: "spaceship" | "cloudflare" | "atom" | "afternic";
  readonly implementation: "fixture";
}

export {
  ENDPOINT_MANIFEST_SCHEMA_VERSION,
  ENDPOINT_MANIFEST_SHA256,
  endpointRegistry,
} from "./generated/endpoint-registry";
export type { EndpointId } from "./generated/endpoint-registry";
