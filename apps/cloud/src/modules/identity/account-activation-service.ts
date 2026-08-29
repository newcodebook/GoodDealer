import {
  ACCOUNT_ACTIVATION_SCHEMA_VERSION,
  accountActivationResponseSchema,
  type AccountActivationRequest,
  type AccountActivationResponse,
} from "@gooddealer/protocol/account";

import type { AccountActivationApplicationPort } from "../../entrypoints/ports/account-activation";
import type { PublicPrincipal } from "../../entrypoints/ports/public-session";
import type { DefaultWorkspaceTenantResolverPort } from "../workspace/default-workspace/index";
import { workspaceTenantKey } from "../workspace/tenant-scope";
import {
  activateAccount,
  activationIdentityFor,
  type ActivationDatabase,
} from "./account-activation";

/** Identity-owned source that freshly revalidates the exact authenticated session. */
export interface AccountActivationSubjectReaderPort {
  readActivationSubject(principal: PublicPrincipal): Promise<unknown | null>;
}

export class AccountActivationConsistencyError extends Error {}

/**
 * Composes identity activation with the workspace-owned default binding. The principal and
 * freshly revalidated subject must agree before the first database write.
 */
export class AccountActivationApplicationService implements AccountActivationApplicationPort {
  constructor(
    private readonly database: ActivationDatabase,
    private readonly subjects: AccountActivationSubjectReaderPort,
    private readonly defaultWorkspaces: DefaultWorkspaceTenantResolverPort,
  ) {}

  async activate(
    request: AccountActivationRequest,
    principal: PublicPrincipal,
  ): Promise<AccountActivationResponse | null> {
    if (principal.clientKind !== "account_web") return null;

    const subject = await this.subjects.readActivationSubject(principal);
    if (subject === null) return null;
    const expectedScope = activationIdentityFor(subject);
    if (expectedScope.accountId !== principal.accountId) return null;

    const activated = await activateAccount(
      this.database,
      { revalidate: async () => subject },
      request,
    );
    const resolved = await this.defaultWorkspaces.resolve(principal);
    if (
      resolved === null
      || workspaceTenantKey(resolved) !== workspaceTenantKey(expectedScope)
      || activated.accountId !== expectedScope.accountId
      || activated.workspaceId !== expectedScope.workspaceId
    ) {
      throw new AccountActivationConsistencyError("activated default workspace is unresolved");
    }

    return accountActivationResponseSchema.parse({
      schemaVersion: ACCOUNT_ACTIVATION_SCHEMA_VERSION,
      state: "active",
    });
  }
}
