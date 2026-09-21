import type {
  DesktopAuthorizationGrant,
  DesktopAuthorizationGrantRequest,
} from "@gooddealer/protocol/devices";

import type { PublicPrincipal } from "./public-session";

/** Null is a closed authorization/signing denial; adapters must not disclose its cause. */
export interface DesktopAuthorizationApplicationPort {
  issue(
    request: DesktopAuthorizationGrantRequest,
    principal: PublicPrincipal,
  ): Promise<DesktopAuthorizationGrant | null>;
}

/** Production remains closed until device-session binding and signing custody are composed. */
export class DenyingDesktopAuthorizationApplicationPort
implements DesktopAuthorizationApplicationPort {
  async issue(): Promise<null> {
    return null;
  }
}
