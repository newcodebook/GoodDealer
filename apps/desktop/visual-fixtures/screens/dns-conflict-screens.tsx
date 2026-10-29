import { defaultLocale, getPresentationCopy } from "@gooddealer/i18n";
import { Banner } from "@gooddealer/ui";
import { useEffect, useState } from "react";

import { DnsVerification } from "../../src/features/dns";
import { ConflictCenter } from "../../src/features/sync/conflict-center";
import { initialMockConflicts, initialMockDnsRows, mockConflictCenter, mockDnsVerification, type MockConflict, type MockDnsRow } from "../mock/dns-conflict-fixtures";
import { MockShell, mockShellStatus } from "../mock/mock-shell";
import type { DesignWindowPlatform } from "../screen-registry";

export const dnsVariants = [{ id: "active", label: "Active · 可修复" }, { id: "standby", label: "Standby · 只读" }] as const;
export const conflictVariants = [{ id: "active", label: "Active · 可裁决" }, { id: "continuation", label: "本地延续 · 不可裁决" }] as const;

interface ScreenProps {
  readonly variant: string;
  readonly platform: DesignWindowPlatform;
  readonly onNavigateScreen: (id: string) => void;
}

/** DNS & verification with mock re-verification that settles after a moment. */
export function DnsScreen({ variant, platform, onNavigateScreen }: ScreenProps) {
  const locale = defaultLocale;
  const shellCopy = getPresentationCopy(locale, "shell");
  const standby = variant === "standby";
  const [rows, setRows] = useState<readonly MockDnsRow[]>(initialMockDnsRows);
  const [verifying, setVerifying] = useState<ReadonlySet<string>>(new Set());
  const [unsynced, setUnsynced] = useState(0);

  useEffect(() => {
    if (verifying.size === 0) return undefined;
    const timer = setTimeout(() => {
      setRows((current) => current.map((row) => verifying.has(row.domain) ? { ...row, ownership: "verified", checkedAt: "2026-08-20T06:10:00Z" } : row));
      setVerifying(new Set());
    }, 1200);
    return () => clearTimeout(timer);
  }, [verifying]);

  return (
    <MockShell
      locale={locale}
      platform={platform}
      activeNavigationId="dns"
      title={getPresentationCopy(locale, "dnsVerification").title}
      status={mockShellStatus(unsynced, verifying.size > 0, standby)}
      onNavigateScreen={onNavigateScreen}
      {...(standby ? { banner: <Banner tone="sync" title={shellCopy.standby}>{shellCopy.standbyNotice}</Banner> } : {})}
    >
      <DnsVerification
        locale={locale}
        view={mockDnsVerification(rows, standby)}
        verifyingIds={verifying}
        onReverify={(targets) => setVerifying(new Set(targets.map((row) => row.domainAssetId)))}
        onRequestTxtPlan={() => onNavigateScreen("batch-preview")}
        onRequestNameserverPlan={(target) => {
          setRows((current) => current.map((row) => row.domain === target.domainAssetId
            ? { ...row, nameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"], delegation: "healthy", propagation: "propagating" }
            : row));
          setUnsynced((count) => count + 1);
        }}
      />
    </MockShell>
  );
}

/** Conflict center deciding one mock candidate at a time. */
export function ConflictScreen({ variant, platform, onNavigateScreen }: ScreenProps) {
  const locale = defaultLocale;
  const canResolve = variant !== "continuation";
  const [conflicts, setConflicts] = useState<readonly MockConflict[]>(initialMockConflicts);
  const [resolving, setResolving] = useState<string | null>(null);

  return (
    <MockShell
      locale={locale}
      platform={platform}
      activeNavigationId="conflicts"
      title={getPresentationCopy(locale, "conflictCenter").title}
      status={mockShellStatus(0, resolving !== null)}
      onNavigateScreen={onNavigateScreen}
    >
      <ConflictCenter
        locale={locale}
        view={mockConflictCenter(conflicts, canResolve)}
        resolvingId={resolving}
        onResolve={(candidateId, choice) => {
          setResolving(candidateId);
          setTimeout(() => {
            setConflicts((current) => current.map((conflict) => conflict.id === candidateId
              ? { ...conflict, status: choice === "keep_local" ? "resolved_local" : "resolved_remote" }
              : conflict));
            setResolving(null);
          }, 600);
        }}
      />
    </MockShell>
  );
}
