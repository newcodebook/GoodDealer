import type { BrowserAutomationGrantPort } from "../browser-automation/index";

import {
  parseAssetProtectionIncidentViewModel,
  parseBatchOperationViewModel,
  parseManualTaskInboxViewModel,
  parseOperationHistoryViewModel,
  parseStartupRecoveryViewModel,
  type AssetProtectionIncidentViewModel,
  type BatchOperationViewModel,
  type ManualTaskInboxViewModel,
  type OperationHistoryViewModel,
  type StartupRecoveryViewModel,
} from "./contracts";
import type {
  AcceptManualTaskRiskCommand,
  ApproveBatchCommand,
  BatchActionCommand,
  CloseProtectionIncidentCommand,
  ManualTaskCommand,
  PlanReversalCommand,
  ProtectionListingCommand,
  RecoveryCheckCommand,
} from "./commands";

export interface OperationsPresentationBoundary {
  loadBatchOperation(batchId: string): Promise<unknown>;
  loadManualTaskInbox(): Promise<unknown>;
  loadOperationHistory(): Promise<unknown>;
  loadStartupRecovery(): Promise<unknown>;
  loadAssetProtectionIncident(incidentId: string): Promise<unknown>;
}

export interface OperationsPresentationPort {
  loadBatchOperation(batchId: string): Promise<BatchOperationViewModel>;
  loadManualTaskInbox(): Promise<ManualTaskInboxViewModel>;
  loadOperationHistory(): Promise<OperationHistoryViewModel>;
  loadStartupRecovery(): Promise<StartupRecoveryViewModel>;
  loadAssetProtectionIncident(incidentId: string): Promise<AssetProtectionIncidentViewModel>;
}

export class ValidatingOperationsPresentationPort implements OperationsPresentationPort {
  readonly #boundary: OperationsPresentationBoundary;

  constructor(boundary: OperationsPresentationBoundary) {
    this.#boundary = boundary;
  }

  async loadBatchOperation(batchId: string): Promise<BatchOperationViewModel> {
    if (batchId.length === 0 || batchId.length > 160) throw new TypeError("invalid batch id");
    return parseBatchOperationViewModel(await this.#boundary.loadBatchOperation(batchId));
  }

  async loadManualTaskInbox(): Promise<ManualTaskInboxViewModel> {
    return parseManualTaskInboxViewModel(await this.#boundary.loadManualTaskInbox());
  }

  async loadOperationHistory(): Promise<OperationHistoryViewModel> {
    return parseOperationHistoryViewModel(await this.#boundary.loadOperationHistory());
  }

  async loadStartupRecovery(): Promise<StartupRecoveryViewModel> {
    return parseStartupRecoveryViewModel(await this.#boundary.loadStartupRecovery());
  }

  async loadAssetProtectionIncident(incidentId: string): Promise<AssetProtectionIncidentViewModel> {
    if (incidentId.length === 0 || incidentId.length > 160) throw new TypeError("invalid incident id");
    return parseAssetProtectionIncidentViewModel(await this.#boundary.loadAssetProtectionIncident(incidentId));
  }
}

export interface OperationApprovalPort {
  approveBatch(command: ApproveBatchCommand): Promise<unknown>;
}

export interface OperationBatchCommandPort {
  requestBatchAction(command: BatchActionCommand): Promise<unknown>;
}

export interface ManualTaskCommandPort {
  requestTaskAction(command: ManualTaskCommand): Promise<unknown>;
  acceptResidualRisk(command: AcceptManualTaskRiskCommand): Promise<unknown>;
}

/** Operations consumes this public grant contract; browser-automation remains its authority owner. */
export type ManualTaskBrowserGrantPort = BrowserAutomationGrantPort;

export interface PlanReversalPort {
  planReversal(command: PlanReversalCommand): Promise<unknown>;
}

export interface OperationRecoveryPort {
  checkOutcomeUnknown(command: RecoveryCheckCommand): Promise<unknown>;
  continueAfterReconciliation(): Promise<unknown>;
}

export interface AssetProtectionCommandPort {
  requestListingAction(command: ProtectionListingCommand): Promise<unknown>;
  closeIncident(command: CloseProtectionIncidentCommand): Promise<unknown>;
}
