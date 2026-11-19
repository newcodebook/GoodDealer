import type { DeviceSwitchRequestResolutionResponse } from "@gooddealer/protocol/devices";
import type { PublicPrincipal } from "./public-session";

/** Read-only reconciliation of a source device's original request identity. */
export interface DeviceSwitchRequestResolutionPort {
  resolve(request: unknown, principal: PublicPrincipal): Promise<DeviceSwitchRequestResolutionResponse | null>;
}
