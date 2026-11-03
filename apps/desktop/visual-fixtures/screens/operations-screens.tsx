import { defaultLocale, getPresentationCopy } from "@gooddealer/i18n";
import { Banner } from "@gooddealer/ui";
import { useState } from "react";

import { ManualTaskInbox } from "../../src/features/operations/manual-tasks";
import { OperationHistory } from "../../src/features/operations/operation-history";
import { MockShell, mockShellStatus } from "../mock/mock-shell";
import {
  initialMockHistory,
  initialMockTasks,
  mockManualTasks,
  mockOperationHistory,
  type MockHistoryEntry,
  type MockTask,
} from "../mock/operations-fixtures";
import type { DesignWindowPlatform } from "../screen-registry";

export const readOnlyVariants = [{ id: "active", label: "Active · 可操作" }, { id: "standby", label: "Standby · 只读" }] as const;

interface ScreenProps {
  readonly variant: string;
  readonly platform: DesignWindowPlatform;
  readonly onNavigateScreen: (id: string) => void;
}

/** Revision ledger where a rollback appends a new reversing Revision and marks the original. */
export function HistoryScreen({ variant, platform, onNavigateScreen }: ScreenProps) {
  const locale = defaultLocale;
  const shellCopy = getPresentationCopy(locale, "shell");
  const standby = variant === "standby";
  const [entries, setEntries] = useState<readonly MockHistoryEntry[]>(initialMockHistory);
  const [selected, setSelected] = useState<number | null>(8241);
  const [unsynced, setUnsynced] = useState(0);

  return (
    <MockShell
      locale={locale}
      platform={platform}
      activeNavigationId="history"
      title={getPresentationCopy(locale, "operationHistory").title}
      status={mockShellStatus(unsynced, false, standby)}
      onNavigateScreen={onNavigateScreen}
      {...(standby ? { banner: <Banner tone="sync" title={shellCopy.standby}>{shellCopy.standbyNotice}</Banner> } : {})}
    >
      <OperationHistory
        locale={locale}
        view={mockOperationHistory(entries, selected, standby)}
        onSelect={(revisionId) => setSelected(Number(revisionId.replace("rev-", "")))}
        onExport={() => undefined}
        onPlanReversal={(entry) => {
          const target = entries.find((candidate) => `rev-${candidate.revision}` === entry.revisionId);
          if (target === undefined) return;
          const next = (entries[0]?.revision ?? 0) + 1;
          setEntries((current) => [
            { ...target, revision: next, at: "2026-08-20T06:20:00Z", action: `回滚 → rev ${entry.revisionLabel}`, state: "applied", diffs: target.diffs.map(([entity, field, oldValue, newValue]) => [entity, field, newValue, oldValue] as const) },
            ...current.map((candidate) => candidate.revision === target.revision ? { ...candidate, state: "rolled_back" as const } : candidate),
          ]);
          setSelected(next);
          setUnsynced((count) => count + 1);
        }}
      />
    </MockShell>
  );
}

/** Manual tasks where "mark done" moves a task to verification instead of marking it successful. */
export function TaskScreen({ variant, platform, onNavigateScreen }: ScreenProps) {
  const locale = defaultLocale;
  const shellCopy = getPresentationCopy(locale, "shell");
  const standby = variant === "standby";
  const [tasks, setTasks] = useState<readonly MockTask[]>(initialMockTasks);
  const [selected, setSelected] = useState<string | null>("task-afternic-csv");
  const update = (id: string, patch: Partial<MockTask>) => setTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task));

  return (
    <MockShell
      locale={locale}
      platform={platform}
      activeNavigationId="inbox"
      title={getPresentationCopy(locale, "manualTaskInbox").title}
      status={mockShellStatus(0, false, standby)}
      onNavigateScreen={onNavigateScreen}
      {...(standby ? { banner: <Banner tone="sync" title={shellCopy.standby}>{shellCopy.standbyNotice}</Banner> } : {})}
    >
      <ManualTaskInbox
        locale={locale}
        view={mockManualTasks(tasks, selected, standby)}
        onSelect={setSelected}
        onAction={(task, action) => {
          if (action === "mark_user_operation_done") update(task.id, { status: "verification_pending" });
          if (action === "cancel") update(task.id, { status: "cancelled", browser: null });
          if (action === "request_automation_grant") update(task.id, { browser: "running" });
        }}
        onAcceptRisk={(task) => update(task.id, { status: "risk_accepted", browser: null })}
        onBrowserControl={(task, control) => update(task.id, control === "terminate" ? { browser: null } : { browser: control === "continue" ? "running" : "paused" })}
      />
    </MockShell>
  );
}
