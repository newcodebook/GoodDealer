import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Badge } from "@gooddealer/ui";

import { batchPhaseTone, type BatchPhase } from "./batch-operations-contract";

export function batchPhaseLabel(locale: Locale, phase: BatchPhase): string {
  const copy = getPresentationCopy(locale, "batchOperation");
  switch (phase) {
    case "planned":
    case "awaiting_approval": return copy.planned;
    case "queued":
    case "running": return copy.running;
    case "completed": return copy.completed;
    case "partially_failed": return copy.partiallyFailed;
    case "rolled_back": return copy.rolledBack;
    case "cancelled": return copy.cancelled;
  }
}

export function BatchPhaseBadge({ locale, phase }: { readonly locale: Locale; readonly phase: BatchPhase }) {
  return <Badge tone={batchPhaseTone(phase)} mono={false}>{batchPhaseLabel(locale, phase)}</Badge>;
}
