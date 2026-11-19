import { invoke } from "@tauri-apps/api/core";
import { copyPlainData } from "@gooddealer/client-core";

export type ForcedTakeoverPreviewReason = "source_unavailable" | "switch_in_progress" | "target_not_standby"
  | "reauthentication_required" | "local_recovery_required" | "history_full";
export type ForcedTakeoverStoppedReason = "reauthentication_required" | "source_changed" | "authorization_changed"
  | "local_recovery_required" | "history_full" | "request_rejected";
export type ForcedTakeoverPreview =
  | { readonly kind: "available"; readonly previewId: string; readonly sourceDeviceId: string;
      readonly sourceLeaseEpoch: number; readonly earliestTakeoverAt: string; readonly evaluatedAt: string }
  | { readonly kind: "unavailable"; readonly reason: ForcedTakeoverPreviewReason };
export type ForcedTakeoverView =
  | { readonly kind: "idle" }
  | { readonly kind: "cancelled_before_request"; readonly intentId: string }
  | { readonly kind: "requesting"; readonly intentId: string }
  | { readonly kind: "waiting"; readonly intentId: string; readonly requestId: string; readonly sourceDeviceId: string;
      readonly earliestTakeoverAt: string; readonly evaluatedAt: string }
  | { readonly kind: "cancelling"; readonly intentId: string; readonly requestId: string | null }
  | { readonly kind: "installing"; readonly intentId: string; readonly requestId: string }
  | { readonly kind: "finished"; readonly intentId: string; readonly requestId: string; readonly status: "cancelled" | "failed" | "completed" }
  | { readonly kind: "stopped"; readonly intentId: string; readonly reason: ForcedTakeoverStoppedReason; readonly canCancel: boolean };
export interface ForcedTakeoverPort {
  /** Starts browser reauthentication only; confirming a fresh preview creates the durable intent. */
  reauthenticate(): Promise<void>;
  preview(): Promise<ForcedTakeoverPreview>;
  readonly confirm: (previewId: string) => Promise<ForcedTakeoverView>;
  status(): Promise<ForcedTakeoverView>;
  cancel(intentId: string): Promise<ForcedTakeoverView>;
}

const previewReasons = ["source_unavailable", "switch_in_progress", "target_not_standby", "reauthentication_required", "local_recovery_required", "history_full"] as const;
const stoppedReasons = ["reauthentication_required", "source_changed", "authorization_changed", "local_recovery_required", "history_full", "request_rejected"] as const;
function rejected(): never { throw new TypeError("invalid forced takeover data"); }
function record(value: unknown): Record<string, unknown> {
  const data = copyPlainData(value);
  if (typeof data !== "object" || data === null || Array.isArray(data)) return rejected();
  return data as Record<string, unknown>;
}
function shape(data: Record<string, unknown>, fields: readonly string[]): void {
  const keys = ["schemaVersion", "kind", ...fields];
  if (data["schemaVersion"] !== 1 || Object.keys(data).length !== keys.length
    || Object.keys(data).some((key) => !keys.includes(key))) rejected();
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,160}$/u.test(value)) return rejected();
  return value;
}
function time(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)) return rejected();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value.replace("Z", ".000Z")) return rejected();
  return value;
}
function preview(value: unknown): ForcedTakeoverPreview {
  const data = record(value);
  if (data["kind"] === "unavailable") {
    shape(data, ["reason"]);
    const reason = previewReasons.find((candidate) => candidate === data["reason"]);
    if (reason === undefined) return rejected();
    return Object.freeze({ kind: "unavailable", reason });
  }
  shape(data, ["previewId", "sourceDeviceId", "sourceLeaseEpoch", "earliestTakeoverAt", "evaluatedAt"]);
  const epoch = data["sourceLeaseEpoch"];
  if (data["kind"] !== "available" || !Number.isSafeInteger(epoch) || (epoch as number) < 1) return rejected();
  const earliestTakeoverAt = time(data["earliestTakeoverAt"]), evaluatedAt = time(data["evaluatedAt"]);
  if (earliestTakeoverAt < evaluatedAt) return rejected();
  return Object.freeze({ kind: "available", previewId: id(data["previewId"]), sourceDeviceId: id(data["sourceDeviceId"]),
    sourceLeaseEpoch: epoch as number, earliestTakeoverAt, evaluatedAt });
}
function view(value: unknown): ForcedTakeoverView {
  const data = record(value), kind = data["kind"];
  if (kind === "idle") { shape(data, []); return Object.freeze({ kind }); }
  const intentId = id(data["intentId"]);
  if (kind === "requesting" || kind === "cancelled_before_request") { shape(data, ["intentId"]); return Object.freeze({ kind, intentId }); }
  if (kind === "stopped") {
    shape(data, ["intentId", "reason", "canCancel"]);
    const reason = stoppedReasons.find((candidate) => candidate === data["reason"]);
    if (reason === undefined || typeof data["canCancel"] !== "boolean") return rejected();
    return Object.freeze({ kind, intentId, reason, canCancel: data["canCancel"] });
  }
  if (kind === "cancelling") {
    shape(data, ["intentId", "requestId"]);
    return Object.freeze({ kind, intentId, requestId: data["requestId"] === null ? null : id(data["requestId"]) });
  }
  const requestId = id(data["requestId"]);
  if (kind === "installing") { shape(data, ["intentId", "requestId"]); return Object.freeze({ kind, intentId, requestId }); }
  if (kind === "finished") {
    shape(data, ["intentId", "requestId", "status"]);
    const status = data["status"];
    if (status !== "cancelled" && status !== "failed" && status !== "completed") return rejected();
    return Object.freeze({ kind, intentId, requestId, status });
  }
  if (kind === "waiting") {
    shape(data, ["intentId", "requestId", "sourceDeviceId", "earliestTakeoverAt", "evaluatedAt"]);
    return Object.freeze({ kind, intentId, requestId, sourceDeviceId: id(data["sourceDeviceId"]),
      earliestTakeoverAt: time(data["earliestTakeoverAt"]), evaluatedAt: time(data["evaluatedAt"]) });
  }
  return rejected();
}
export function createForcedTakeoverPort(): ForcedTakeoverPort {
  const body = (field: string, value: string) => new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, [field]: id(value) }));
  return {
    async reauthenticate() { if (await invoke("forced_takeover_reauthenticate") !== null) rejected(); },
    async preview() { return preview(await invoke("forced_takeover_preview")); },
    confirm: async (previewId) => {
      const result = view(await invoke("forced_takeover_confirm", body("previewId", previewId)));
      if (result.kind === "idle") return rejected();
      return result;
    },
    async status() { return view(await invoke("forced_takeover_status")); },
    async cancel(intentId) {
      const result = view(await invoke("forced_takeover_cancel", body("intentId", intentId)));
      if (result.kind === "idle" || result.intentId !== intentId) return rejected();
      return result;
    },
  };
}
