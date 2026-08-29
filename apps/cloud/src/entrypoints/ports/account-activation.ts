import type {
  AccountActivationRequest,
  AccountActivationResponse,
} from "@gooddealer/protocol/account";

import type { PublicPrincipal } from "./public-session";

/** Null is an authorization denial; adapters must not disclose its cause. */
export interface AccountActivationApplicationPort {
  activate(
    request: AccountActivationRequest,
    principal: PublicPrincipal,
  ): Promise<AccountActivationResponse | null>;
}
