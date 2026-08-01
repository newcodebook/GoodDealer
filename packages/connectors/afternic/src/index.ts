import type { BrowserProbeReport } from "@gooddealer/browser-automation/contracts";
import type { ConnectorRegistration } from "@gooddealer/connector-sdk";

export const afternicConnector = {
  id: "afternic",
  implementation: "fixture",
} as const satisfies ConnectorRegistration;

export type AfternicProbeReport = BrowserProbeReport;
