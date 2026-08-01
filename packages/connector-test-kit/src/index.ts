import type { ConnectorRegistration } from "@gooddealer/connector-sdk";

export function assertFixtureConnector(connector: ConnectorRegistration) {
  if (connector.implementation !== "fixture") throw new Error("Phase 0 connector must be a fixture");
}
