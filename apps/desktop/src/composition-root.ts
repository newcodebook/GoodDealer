import { afternicConnector } from "@gooddealer/connector-afternic";
import { atomConnector } from "@gooddealer/connector-atom";
import { cloudflareConnector } from "@gooddealer/connector-cloudflare";
import type { ConnectorRegistration } from "@gooddealer/connector-sdk";
import { spaceshipConnector } from "@gooddealer/connector-spaceship";

export const registeredConnectors = [
  spaceshipConnector,
  cloudflareConnector,
  atomConnector,
  afternicConnector,
] as const satisfies readonly ConnectorRegistration[];

export const registeredConnectorIds = registeredConnectors.map(({ id }) => id);
