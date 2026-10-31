import { getAccountCopy, type Locale } from "@gooddealer/i18n";
import type { ReactNode } from "react";

import { AccountShell } from "../../src/app-shell/account-shell";
import { accountRouteIds, type AccountRouteId } from "../../src/app-shell/account-route";

/** Frames a designed screen in the full account shell; navigation is inert inside a fixture. */
export function FixtureShell({ locale, routeId, children }: { readonly locale: Locale; readonly routeId: AccountRouteId; readonly children: ReactNode }) {
  const copy = getAccountCopy(locale, "accountShell");
  return (
    <AccountShell
      locale={locale}
      title={copy[routeId]}
      availableRouteIds={accountRouteIds}
      activeRouteId={routeId}
      onNavigate={() => undefined}
      onSignOut={() => undefined}
      onRefresh={() => undefined}
    >
      {children}
    </AccountShell>
  );
}
