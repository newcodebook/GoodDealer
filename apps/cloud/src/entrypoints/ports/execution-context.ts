import type { DesktopExecutionContextResponse } from "@gooddealer/protocol/devices";
import type { PublicPrincipal } from "./public-session";
export interface DesktopExecutionContextApplicationPort {
  issue(request: unknown, principal: PublicPrincipal): Promise<DesktopExecutionContextResponse | null>;
}
