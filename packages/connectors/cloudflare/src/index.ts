import type { ConnectorRegistration } from "@gooddealer/connector-sdk";

export const cloudflareConnector = {
  id: "cloudflare",
  implementation: "fixture",
} as const satisfies ConnectorRegistration;
