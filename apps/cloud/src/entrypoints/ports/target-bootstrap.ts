import type { DeviceBootstrapStatusResponse, DeviceSwitchResponse } from "@gooddealer/protocol/devices";
import type { PublicPrincipal } from "./public-session";

/** Bound target-only control; terminating setup never grants execution authority. */
export interface TargetBootstrapControlPort {
  status(request: unknown, principal: PublicPrincipal): Promise<DeviceBootstrapStatusResponse | null>;
  cancel(request: unknown, principal: PublicPrincipal): Promise<DeviceSwitchResponse | null>;
}
