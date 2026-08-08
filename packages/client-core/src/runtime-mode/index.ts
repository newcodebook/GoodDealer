import type { RuntimeStatus } from "@gooddealer/protocol/devices";

export type RuntimeMode = RuntimeStatus["mode"];

/** Read-only Host boundary. Runtime authority and transitions remain in Rust. */
export interface RuntimeStatusPort {
  getStatus(): Promise<RuntimeStatus>;
}
