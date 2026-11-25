import type {
  DesktopAuthorizationGrantRoleResponse,
  DesktopAuthorizationGrantRoleRequest,
} from "@gooddealer/protocol/devices";

import type { PublicPrincipal } from "./public-session";

/** Null is a closed authorization/signing denial; adapters must not disclose its cause. */
export interface DesktopAuthorizationApplicationPort {
  issue(
    request: DesktopAuthorizationGrantRoleRequest,
    principal: PublicPrincipal,
  ): Promise<DesktopAuthorizationGrantRoleResponse | null>;
}

/** Production remains closed until device-session binding and signing custody are composed. */
export class DenyingDesktopAuthorizationApplicationPort
implements DesktopAuthorizationApplicationPort {
  async issue(): Promise<null> {
    return null;
  }
}
