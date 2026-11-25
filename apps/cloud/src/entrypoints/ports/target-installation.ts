import type {
  DeviceBootstrapActivationResponse,
  DeviceBootstrapCheckpointResponse,
  DeviceBootstrapClaimResponse,
  DeviceBootstrapReceiptResponse,
  DeviceBootstrapStepResponse,
} from "@gooddealer/protocol/devices";
import type { PublicPrincipal } from "./public-session";

/** Each method rechecks the exact workflow target in its final database transaction. */
export interface TargetBootstrapInstallationPort {
  claim(request: unknown, principal: PublicPrincipal): Promise<DeviceBootstrapClaimResponse | null>;
  step(request: unknown, principal: PublicPrincipal): Promise<DeviceBootstrapStepResponse | null>;
  checkpoint(request: unknown, principal: PublicPrincipal): Promise<DeviceBootstrapCheckpointResponse | null>;
  activate(request: unknown, principal: PublicPrincipal): Promise<DeviceBootstrapActivationResponse | null>;
  receipt(request: unknown, principal: PublicPrincipal): Promise<DeviceBootstrapReceiptResponse | null>;
}
