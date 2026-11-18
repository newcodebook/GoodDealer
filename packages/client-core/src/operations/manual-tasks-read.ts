import { z } from "zod";

import { launchPlatformKindSchema, launchPlatformNames } from "../connections/launch-platforms";
import { connectionLabelSchema } from "../connections/connection-label";
import { copyPlainData, portfolioFreshnessSchema } from "../portfolio/view-models";
import { manualTaskDomainSampleLimit, manualTaskInboxViewModelSchema, type ManualTaskInboxViewModel, type ManualTaskView } from "./contracts";

const tokenSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
const countSchema = z.number().int().nonnegative().max(1_000_000);
const displaySchema = (limit: number) => z.string().min(1)
  .refine((value) => Array.from(value).length <= limit, `at most ${limit} characters`)
  .refine((value) => !/[\p{Cc}]/u.test(value), "display text rejects control characters");

/**
 * One manual task: plan items waiting on the person in a platform's own console. It carries no
 * browser session, automation, authorization or credential field; any extra field is rejected.
 */
const manualTaskRowSchema = z.object({
  title: displaySchema(500),
  operationKind: tokenSchema,
  capability: tokenSchema,
  providerKind: launchPlatformKindSchema.nullable(),
  connectionLabel: connectionLabelSchema.nullable(),
  highRisk: z.boolean(),
  itemCount: countSchema.min(1),
  waitingSince: z.iso.datetime(),
  lastObservedAt: z.iso.datetime().nullable(),
  domainCount: countSchema,
  domains: z.array(z.string().min(3).max(253)).max(manualTaskDomainSampleLimit).readonly(),
}).strict().superRefine((row, context) => {
  if ((row.providerKind === null) !== (row.connectionLabel === null)) {
    context.addIssue({ code: "custom", path: ["connectionLabel"], message: "a label exists exactly when a connection does" });
  }
  if (row.domains.length !== Math.min(row.domainCount, manualTaskDomainSampleLimit) || row.domainCount > row.itemCount) {
    context.addIssue({ code: "custom", path: ["domains"], message: "domains must match their count" });
  }
  for (let index = 1; index < row.domains.length; index += 1) {
    if (row.domains[index - 1]! >= row.domains[index]!) {
      context.addIssue({ code: "custom", path: ["domains", index], message: "domains must be unique and ordered" });
      break;
    }
  }
});

export const manualTasksWindowRequestSchema = z.object({
  startIndex: z.number().int().nonnegative().max(1_000_000),
  size: z.number().int().min(1).max(200),
}).strict();

/** Host manual task window: oldest waiting first, without plan, operation or connection identifiers. */
export const manualTasksReadSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("manual_tasks"),
  readGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  freshness: portfolioFreshnessSchema,
  totalRows: z.number().int().nonnegative().max(1_000_200),
  window: z.object({
    startIndex: manualTasksWindowRequestSchema.shape.startIndex,
    size: manualTasksWindowRequestSchema.shape.size,
    rows: z.array(manualTaskRowSchema).max(200).readonly(),
  }).strict(),
}).strict().superRefine((read, context) => {
  const { startIndex, size, rows } = read.window;
  if (rows.length > size || startIndex + rows.length > read.totalRows) {
    context.addIssue({ code: "custom", path: ["window", "rows"], message: "window exceeds its bounds" });
  }
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1]!.waitingSince > rows[index]!.waitingSince) {
      context.addIssue({ code: "custom", path: ["window", "rows", index], message: "rows must be oldest waiting first" });
      break;
    }
  }
});

export type ManualTasksWindowRequest = z.infer<typeof manualTasksWindowRequestSchema>;
export type ManualTasksRead = z.infer<typeof manualTasksReadSchema>;
export type ManualTaskRow = z.infer<typeof manualTaskRowSchema>;

export function parseManualTasksRead(input: unknown): ManualTasksRead {
  return manualTasksReadSchema.parse(copyPlainData(input));
}

export interface ManualTasksReadPort {
  loadManualTasks(request: ManualTasksWindowRequest): Promise<ManualTasksRead>;
}

/** Localized labels the projection needs; the Host read carries none. */
export interface ManualTaskProjectionLabels {
  /** Why the step is manual, given the platform (`null` when none is bound) and capability. */
  readonly reason: (platform: string | null, capability: string) => string;
  readonly completionCondition: string;
  readonly noPlatform: string;
  readonly noAccount: string;
}

/**
 * Projects complete Host manual task windows of one generation into the inbox. Keys are scoped to
 * this read, never plan or operation identifiers. No task offers an action: opening the platform,
 * reporting completion and re-checking need qualified Host capabilities, and nothing here can drive
 * a platform on the person's behalf.
 */
export function projectManualTaskInbox(
  windows: readonly ManualTasksRead[],
  labels: ManualTaskProjectionLabels,
  selectedTaskId: string | null,
): ManualTaskInboxViewModel {
  const first = windows[0];
  if (first === undefined) throw new TypeError("manual tasks need at least one Host window");
  let expectedStart = 0;
  for (const window of windows) {
    if (window.readGeneration !== first.readGeneration || window.totalRows !== first.totalRows
      || window.window.startIndex !== expectedStart) {
      throw new TypeError("manual task windows must be contiguous reads of one Host generation");
    }
    expectedStart += window.window.rows.length;
  }
  if (expectedStart !== first.totalRows) throw new TypeError("manual task windows must cover every task");
  const tasks = windows.flatMap((window) => window.window.rows).map((row, index): ManualTaskView => {
    const platform = row.providerKind === null ? labels.noPlatform : launchPlatformNames[row.providerKind];
    return {
      id: `task-${index}`,
      revision: 1,
      operationPlanId: `plan-${index}`,
      title: row.title,
      priority: row.highRisk ? "high" : "normal",
      status: "awaiting_user",
      platform,
      account: row.connectionLabel ?? labels.noAccount,
      reason: labels.reason(row.providerKind === null ? null : platform, row.capability),
      affectedDomains: [...row.domains],
      affectedDomainCount: row.domainCount,
      preparedArtifactLabel: null,
      completionCondition: labels.completionCondition,
      lastCheckedAt: row.lastObservedAt,
      checklist: [],
      riskAcceptancePolicy: "forbidden",
      unresolvedImpactDigest: null,
      availableActions: [],
    };
  });
  return manualTaskInboxViewModelSchema.parse({
    schemaVersion: 1,
    kind: "manual_task_inbox",
    source: first.freshness.source,
    commandAdmission: "unavailable",
    selectedTaskId: tasks.some((task) => task.id === selectedTaskId) ? selectedTaskId : null,
    tasks,
  });
}
