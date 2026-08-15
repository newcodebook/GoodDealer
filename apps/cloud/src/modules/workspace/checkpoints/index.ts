import type { CheckpointDescriptor } from "@gooddealer/protocol/workspace";

import type { CheckpointCatalogPort } from "../../devices/ports";
import type { WorkspaceBindingPort } from "../revisions/index";
import type { WorkspaceTenantScope } from "../tenant-scope";
import { workspaceTenantKey } from "../tenant-scope";

/** Minimal published-checkpoint fixture required by tenant-isolation and Bootstrap port tests. */
export class InMemoryCheckpointCatalog implements CheckpointCatalogPort {
  readonly #bindings: WorkspaceBindingPort;
  readonly #checkpoints = new Map<string, Map<string, CheckpointDescriptor>>();
  readonly #pins = new Map<string, Set<string>>();

  constructor(bindings: WorkspaceBindingPort) {
    this.#bindings = bindings;
  }

  publishFixtureCheckpoint(scope: WorkspaceTenantScope, checkpoint: CheckpointDescriptor): void {
    const binding = this.#bindings.resolveWorkspace(scope);
    if (!binding.bound || checkpoint.workspaceId !== scope.workspaceId) {
      throw new TypeError("checkpoint tenant scope is unresolved");
    }
    const key = workspaceTenantKey(scope);
    const checkpoints = this.#checkpoints.get(key) ?? new Map();
    checkpoints.set(checkpoint.checkpointId, structuredClone(checkpoint));
    this.#checkpoints.set(key, checkpoints);
  }

  async selectPublishedCheckpoint(
    scope: WorkspaceTenantScope,
    checkpointId: string,
  ): Promise<CheckpointDescriptor | null> {
    if (!this.#bindings.resolveWorkspace(scope).bound) return null;
    const checkpoint = this.#checkpoints.get(workspaceTenantKey(scope))?.get(checkpointId);
    return checkpoint === undefined ? null : structuredClone(checkpoint);
  }

  async pinCheckpoint(scope: WorkspaceTenantScope, checkpointId: string, until: string): Promise<boolean> {
    if (!this.#bindings.resolveWorkspace(scope).bound) return false;
    if (this.#checkpoints.get(workspaceTenantKey(scope))?.has(checkpointId) !== true) return false;
    const key = workspaceTenantKey(scope);
    const pins = this.#pins.get(key) ?? new Set();
    pins.add(`${checkpointId}\u0000${until}`);
    this.#pins.set(key, pins);
    return true;
  }

  async releasePin(scope: WorkspaceTenantScope, checkpointId: string, _workflowId: string): Promise<void> {
    const pins = this.#pins.get(workspaceTenantKey(scope));
    if (pins === undefined) return;
    for (const pin of pins) if (pin.startsWith(`${checkpointId}\u0000`)) pins.delete(pin);
  }

  pinCount(scope: WorkspaceTenantScope): number {
    return this.#pins.get(workspaceTenantKey(scope))?.size ?? 0;
  }
}
