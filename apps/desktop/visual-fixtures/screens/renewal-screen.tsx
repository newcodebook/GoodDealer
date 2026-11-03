import { defaultLocale, getPresentationCopy } from "@gooddealer/i18n";
import { useState } from "react";

import { RenewalDesk, type RenewalQuote } from "../../src/features/registration/renewal-desk";
import { MockShell, mockShellStatus } from "../mock/mock-shell";
import {
  initialMockRenewals,
  mockRenewalQuotes,
  projectMockRenewalPlan,
  projectMockRenewals,
  type MockRenewalRow,
} from "../mock/renewal-fixtures";
import type { DesignWindowPlatform } from "../screen-registry";

/** Renewal desk with a mock plan and a one-by-one payment confirmation queue (ADR-0024). */
export function RenewalScreen({ platform, onNavigateScreen }: {
  readonly platform: DesignWindowPlatform;
  readonly onNavigateScreen: (id: string) => void;
}) {
  const locale = defaultLocale;
  const [rows, setRows] = useState<readonly MockRenewalRow[]>(initialMockRenewals);
  const [planOpen, setPlanOpen] = useState(false);
  const [quotes, setQuotes] = useState<readonly RenewalQuote[] | null>(null);
  const [unsynced, setUnsynced] = useState(0);
  const update = (ids: readonly string[], patch: (row: MockRenewalRow) => MockRenewalRow) =>
    setRows((current) => current.map((row) => ids.includes(row.id) ? patch(row) : row));
  const resolveQuote = (itemId: string, state: "confirmed" | "skipped") => {
    setQuotes((current) => current?.map((quote) => quote.itemId === itemId ? { ...quote, state } : quote) ?? null);
    if (state === "confirmed") update([itemId], (row) => ({ ...row, status: "planned", selected: false }));
    setUnsynced((count) => count + (state === "confirmed" ? 1 : 0));
  };

  return (
    <MockShell
      locale={locale}
      platform={platform}
      activeNavigationId="assets"
      title={getPresentationCopy(locale, "renewalDesk").renew}
      crumb={getPresentationCopy(locale, "assetLibrary").title}
      status={mockShellStatus(unsynced, false)}
      onNavigateScreen={onNavigateScreen}
    >
      <RenewalDesk
        locale={locale}
        view={projectMockRenewals(rows)}
        onBack={() => onNavigateScreen("asset-library")}
        onSelectionChange={(ids) => setRows((current) => current.map((row) => ({ ...row, selected: row.status === "due" && ids.includes(row.id) })))}
        onTermChange={(ids, years) => update(ids, (row) => ({ ...row, termYears: years }))}
        onAutoRenewChange={(id, enabled) => { update([id], (row) => ({ ...row, autoRenewEnabled: enabled })); setUnsynced((count) => count + 1); }}
        onReviewPlan={() => setPlanOpen(true)}
        plan={planOpen ? projectMockRenewalPlan(rows) : null}
        onCancelPlan={() => setPlanOpen(false)}
        onCreatePlan={() => { setQuotes(mockRenewalQuotes(rows)); setPlanOpen(false); }}
        quotes={quotes}
        onConfirmQuote={(itemId) => resolveQuote(itemId, "confirmed")}
        onSkipQuote={(itemId) => resolveQuote(itemId, "skipped")}
        onCloseQuotes={() => { setQuotes(null); setRows((current) => current.map((row) => ({ ...row, selected: false }))); }}
      />
    </MockShell>
  );
}
