import { defaultLocale, getPresentationCopy } from "@gooddealer/i18n";
import { useEffect, useMemo, useState } from "react";

import { BatchDetail, BatchList, type BatchPhase } from "../../src/features/operations/batch-operations";
import { mockBatchDetail, mockBatchJobs, mockBatchProgress } from "../mock/batch-fixtures";
import { MockShell, mockShellStatus } from "../mock/mock-shell";
import type { DesignWindowPlatform } from "../screen-registry";

export type BatchVariant = "list" | "b-draft" | "b-run" | "b-done" | "b-part" | "b-rb";

export const batchVariants: readonly { readonly id: BatchVariant; readonly label: string }[] = [
  { id: "list", label: "列表" },
  { id: "b-draft", label: "计划 · 含高风险" },
  { id: "b-run", label: "执行中" },
  { id: "b-done", label: "已完成" },
  { id: "b-part", label: "部分失败" },
  { id: "b-rb", label: "已回滚" },
];

/** Batch list ↔ detail with a simulated approval → execution → result run for the draft batch. */
export function BatchScreen({ variant, platform, onNavigateScreen }: {
  readonly variant: BatchVariant;
  readonly platform: DesignWindowPlatform;
  readonly onNavigateScreen: (id: string) => void;
}) {
  const locale = defaultLocale;
  const copy = getPresentationCopy(locale, "batchOperation");
  const [openId, setOpenId] = useState<string | null>(variant === "list" ? null : variant);
  const [excluded, setExcluded] = useState<readonly string[]>([]);
  const [phaseOverride, setPhaseOverride] = useState<BatchPhase | null>(null);
  const [percent, setPercent] = useState(0);
  const job = mockBatchJobs.find((candidate) => candidate.id === openId) ?? null;
  const phase = phaseOverride ?? job?.phase ?? null;

  // An approved draft runs to completion in a few seconds so the run and result views can be reviewed.
  useEffect(() => {
    if (phaseOverride !== "running") return undefined;
    const timer = setInterval(() => setPercent((value) => {
      if (value >= 100) { clearInterval(timer); setPhaseOverride("completed"); return 100; }
      return value + 4;
    }), 120);
    return () => clearInterval(timer);
  }, [phaseOverride]);

  const detail = useMemo(() => job === null || phase === null ? null : mockBatchDetail(job, excluded, phase), [job, excluded, phase]);
  const progress = job === null ? undefined : mockBatchProgress(job, phaseOverride === null ? job.progressPercent : percent);
  const approve = () => { setPercent(0); setPhaseOverride("running"); };

  return (
    <MockShell
      locale={locale}
      platform={platform}
      activeNavigationId="batch"
      title={job === null ? copy.title : job.title}
      {...(job === null ? {} : { crumb: copy.title })}
      status={mockShellStatus(0, phase === "running")}
      onNavigateScreen={onNavigateScreen}
    >
      {job === null || detail === null ? (
        <BatchList locale={locale} jobs={mockBatchJobs} onOpen={setOpenId} onCreateFromLibrary={() => onNavigateScreen("asset-library")} />
      ) : (
        <BatchDetail
          locale={locale}
          batch={detail}
          {...(progress === undefined ? {} : { progress })}
          onBack={() => { setOpenId(null); setExcluded([]); setPhaseOverride(null); }}
          onApprove={approve}
          onApproveStandardOnly={approve}
          onExcludeItem={(itemId, exclude) => setExcluded((current) => exclude ? [...current, itemId] : current.filter((id) => id !== itemId))}
          onRetryFailed={() => undefined}
          onCheckUnknown={() => undefined}
          onOpenManualTasks={() => onNavigateScreen("task-inbox")}
          onOpenHistory={() => onNavigateScreen("history-log")}
        />
      )}
    </MockShell>
  );
}
