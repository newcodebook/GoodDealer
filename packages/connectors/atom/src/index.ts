import type { ConnectorRegistration } from "@gooddealer/connector-sdk";

export const atomConnector = {
  id: "atom",
  implementation: "fixture",
} as const satisfies ConnectorRegistration;
