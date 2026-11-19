import type {
  ForcedTakeoverPreviewResponse, ForcedTakeoverResolveResponse, ForcedTakeoverStatusResponse,
  ForcedTakeoverCancelIntentResponse,
} from "@gooddealer/protocol/devices";
import type { PublicPrincipal } from "./public-session";

/** Target-only discovery and reconciliation; the session owns every scope selector. */
export interface ForcedTakeoverQueryPort {
  preview(value: unknown, principal: PublicPrincipal): Promise<ForcedTakeoverPreviewResponse | null>;
  status(value: unknown, principal: PublicPrincipal): Promise<ForcedTakeoverStatusResponse | null>;
  resolve(value: unknown, principal: PublicPrincipal): Promise<ForcedTakeoverResolveResponse | null>;
  cancelIntent(value: unknown, principal: PublicPrincipal): Promise<ForcedTakeoverCancelIntentResponse | null>;
}
