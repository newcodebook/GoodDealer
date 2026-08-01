import type { ConnectorRegistration } from "@gooddealer/connector-sdk";

export const spaceshipConnector = {
  id: "spaceship",
  implementation: "fixture",
} as const satisfies ConnectorRegistration;
