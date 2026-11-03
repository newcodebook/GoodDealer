import { getAccountCopy, type Locale } from "@gooddealer/i18n";
import { useState } from "react";

import { AccountShell } from "../../src/app-shell/account-shell";
import { accountRouteIds, productionAccountRouteIds, type AccountRouteId } from "../../src/app-shell/account-route";

export const shellVariants = [
  { id: "full", label: "全部页面" },
  { id: "production", label: "生产可用" },
] as const;

export function ShellScreen({ variant, locale }: { readonly variant: string; readonly locale: Locale }) {
  const copy = getAccountCopy(locale, "accountShell");
  const available = variant === "production" ? productionAccountRouteIds : accountRouteIds;
  const [active, setActive] = useState<AccountRouteId>(available[0] ?? "license");
  const [refreshing, setRefreshing] = useState(false);
  return (
    <AccountShell
      locale={locale}
      title={copy[active]}
      availableRouteIds={available}
      activeRouteId={active}
      onNavigate={setActive}
      onSignOut={() => undefined}
      onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 900); }}
      refreshing={refreshing}
    >
      <div className="design-shell-placeholder gd-t-body-2">{copy[active]}</div>
    </AccountShell>
  );
}
