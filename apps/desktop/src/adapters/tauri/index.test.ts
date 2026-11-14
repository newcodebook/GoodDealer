import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { createCloudflarePort, createLocalBatchOperationsPort, createLocalBusinessPort, createLocalDeviceLeasePort, createLocalDnsHealthPort, createLocalHistoryPort, createLocalManualTasksPort, createLocalRenewalsPort, createLocalSalesPort, createLocalSettingsPort, LocalReadError, LocalWriteError } from "./index";

describe("Desktop Tauri local-business adapter", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("creates a connection through its own command and rejects hostile receipts", async () => {
    const receipt = { schemaVersion: 1, connectionRef: "5f0c1e4a-8c1b-4d2e-9f3a-0b1c2d3e4f50", displayLabel: "Cloudflare DNS", created: true, readGeneration: 3 };
    invokeMock.mockResolvedValueOnce(receipt);
    await expect(createCloudflarePort().create("Cloudflare DNS")).resolves.toEqual(receipt);
    expect(invokeMock).toHaveBeenCalledWith("cloudflare_connection_create", { request: { schemaVersion: 1, displayLabel: "Cloudflare DNS" } });
    for (const hostile of [
      { ...receipt, connectionIncarnationId: "leak" },
      { ...receipt, connectionRef: "with space" },
      { ...receipt, created: "yes" },
      { ...receipt, displayLabel: "Cloud\u200bflare" },
      { ...receipt, displayLabel: "x".repeat(121) },
      { ...receipt, readGeneration: -1 },
      { ...receipt, schemaVersion: 2 },
      null,
    ]) {
      invokeMock.mockResolvedValueOnce(hostile);
      await expect(createCloudflarePort().create("Cloudflare DNS")).rejects.toThrow(TypeError);
    }
    await expect(createCloudflarePort().create("")).rejects.toThrow(TypeError);
    // The same label rule as every Host read: format and control characters, and more than 120
    // UTF-16 units, are refused before any IPC.
    for (const label of ["Cloud\u200bflare", "Cloud\u0007flare", "x".repeat(121)]) {
      invokeMock.mockClear();
      await expect(createCloudflarePort().create(label)).rejects.toThrow(TypeError);
      expect(invokeMock).not.toHaveBeenCalled();
    }
  });

  it("reads the Host status with qualification and only closed operation outcomes", async () => {
    const status = { schemaVersion: 1, state: "ready", connectionRef: "opaque", displayLabel: "Cloudflare DNS", qualified: false, capturable: true, lastOperation: { kind: "observe", outcome: "unqualified" }, readGeneration: 2 };
    invokeMock.mockResolvedValueOnce(status);
    await expect(createCloudflarePort().status()).resolves.toEqual(status);
    invokeMock.mockResolvedValueOnce({ ...status, lastOperation: { kind: "revoke", outcome: "nothing_to_revoke" } });
    await expect(createCloudflarePort().status()).resolves.toMatchObject({ lastOperation: { kind: "revoke", outcome: "nothing_to_revoke" } });
    for (const outcome of ["unreachable", "retry_later", "credential_rejected", "zone_unimportable"] as const) {
      invokeMock.mockResolvedValueOnce({ ...status, lastOperation: { kind: "activate", outcome } });
      await expect(createCloudflarePort().status()).resolves.toMatchObject({ lastOperation: { kind: "activate", outcome } });
    }
    for (const hostile of [
      { ...status, qualified: "yes" },
      { ...status, qualified: undefined },
      { ...status, capturable: "yes" },
      { ...status, capturable: undefined },
      { ...status, lastOperation: undefined },
      { ...status, lastOperation: { kind: "observe", outcome: "nothing_to_revoke" } },
      { ...status, lastOperation: { kind: "revoke", outcome: "unreachable" } },
      { ...status, lastOperation: { kind: "revoke", outcome: "credential_rejected" } },
      { ...status, lastOperation: { kind: "observe", outcome: "zone_unimportable" } },
      { ...status, lastOperation: { kind: "revoke", outcome: "zone_unimportable" } },
      { ...status, lastOperation: { kind: "purge", outcome: "unreachable" } },
      { ...status, lastOperation: { kind: "purge", outcome: "unqualified" } },
      { ...status, lastOperation: { kind: "bid", outcome: "confirmed" } },
      { ...status, lastOperation: { kind: "observe", outcome: "ok" } },
      { ...status, lastOperation: { kind: "observe", outcome: "failed", reason: "token rejected" } },
      { ...status, secret: "leak" },
      { ...status, displayLabel: "Cloud\u200bflare" },
      { ...status, displayLabel: "a".repeat(121) },
      { ...status, displayLabel: "" },
    ]) {
      invokeMock.mockResolvedValueOnce(hostile);
      await expect(createCloudflarePort().status()).rejects.toThrow(TypeError);
    }
  });

  it("validates cleanup targets and sends only closed first-confirmed or pending-retry actions", async () => {
    const candidate = { connectionRef: "opaque", displayLabel: "Cloudflare DNS", action: "retry_revoke" };
    invokeMock.mockResolvedValueOnce({ schemaVersion: 1, candidates: [candidate] });
    await expect(createCloudflarePort().retirementCandidates()).resolves.toEqual([candidate]);
    for (const candidates of [[{ ...candidate, digest: "leak" }], [{ ...candidate, action: "yes" }], [{ ...candidate, action: undefined }], [{ connectionRef: "opaque", displayLabel: "Cloudflare DNS", pending: true }], [candidate, candidate], [{ ...candidate, connectionRef: "with space" }], Array(65).fill(candidate)]) {
      invokeMock.mockResolvedValueOnce({ schemaVersion: 1, candidates });
      await expect(createCloudflarePort().retirementCandidates()).rejects.toThrow(TypeError);
    }
    invokeMock.mockClear();
    for (const action of ["confirm_retirement", "retry_pending"] as const) {
      await createCloudflarePort().purge("opaque", action);
      expect(invokeMock).toHaveBeenLastCalledWith("cloudflare_connection_purge", { request: { schemaVersion: 1, connectionId: "opaque", action } });
    }
    await expect(createCloudflarePort().purge("with space", "retry_pending")).rejects.toThrow(TypeError);
    // @ts-expect-error Exercise the untrusted runtime boundary.
    await expect(createCloudflarePort().purge("opaque", "force")).rejects.toThrow(TypeError);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("revokes through its own command with only a bounded connection reference", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await createCloudflarePort().revoke("connection-opaque");
    expect(invokeMock).toHaveBeenCalledWith("cloudflare_connection_revoke", { request: { schemaVersion: 1, connectionId: "connection-opaque" } });
    for (const hostile of ["", "with space", "x".repeat(257), "token\u0000"]) {
      await expect(createCloudflarePort().revoke(hostile)).rejects.toThrow(TypeError);
    }
    expect(invokeMock).toHaveBeenCalledOnce();
  });

  it("binds through the narrow validating capability and rejects hostile IPC receipts", async () => {
    const request = { schemaVersion: 1 as const, expectedReadGeneration: 4, entityId: "example.test" };
    const receipt = {
      schemaVersion: 1, disposition: "committed", entityId: "example.test",
      providerKind: "cloudflare", resourceKind: "zone", resourceBindingDigest: "a".repeat(64),
      resourceLabel: "example.test", bindingGeneration: 2, validationStatus: "verified",
      verifiedAt: "2026-08-17T05:00:00Z", lastObservedAt: "2026-08-17T05:00:00Z",
      localCommitSequence: 8, readGeneration: 5,
    };
    const port = createLocalBusinessPort();
    invokeMock.mockResolvedValueOnce(receipt);
    await expect(port.bindDomainAssetProvider(request)).resolves.toEqual(receipt);
    expect(invokeMock).toHaveBeenCalledWith("local_domain_asset_provider_bind", { request });
    for (const invalid of [
      { ...receipt, entityId: "other.test" }, { ...receipt, readGeneration: 6 },
      { ...receipt, disposition: "replayed", readGeneration: 3 }, { ...receipt, token: "canary" },
    ]) {
      invokeMock.mockResolvedValueOnce(invalid);
      await expect(port.bindDomainAssetProvider(request)).rejects.toThrow();
    }
    invokeMock.mockClear();
    await expect(port.bindDomainAssetProvider({ ...request, workspaceId: "canary" } as never)).rejects.toThrow();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("adds a domain through the narrow command, names a duplicate, and checks the receipt is this write's", async () => {
    const request = { mutationId: "create-1", expectedReadGeneration: 4, asset: { entityId: "added.test", note: null, portfolioId: null, tags: [], targetPrice: null } };
    const receipt = {
      schemaVersion: 1, disposition: "committed", operation: "create", mutationId: "create-1", entityId: "added.test",
      localCommitSequence: 3, deviceMutationSequence: 2, baseServerRevision: 0, activeLeaseEpoch: 7,
      committedAt: "2026-11-06T00:00:00Z", readGeneration: 0,
    };
    const port = createLocalBusinessPort();
    invokeMock.mockResolvedValueOnce(receipt);
    await expect(port.createDomainAsset(request)).resolves.toEqual(receipt);
    expect(invokeMock).toHaveBeenCalledWith("local_domain_asset_create", { request });

    for (const code of ["DESKTOP_LOCAL_ASSET_EXISTS", "DESKTOP_LOCAL_ASSET_DELETED"] as const) {
      invokeMock.mockRejectedValueOnce(code);
      await expect(port.createDomainAsset(request)).rejects.toEqual(expect.objectContaining({ name: "LocalWriteError", code }));
    }
    // Only exact codes are named; a near miss or a non-string stays the Host's opaque refusal.
    for (const opaque of ["DESKTOP_LOCAL_ASSET_DELETED ", "desktop_local_asset_deleted", { code: "DESKTOP_LOCAL_ASSET_DELETED" }]) {
      invokeMock.mockRejectedValueOnce(opaque);
      await expect(port.createDomainAsset(request)).rejects.not.toBeInstanceOf(LocalWriteError);
    }
    invokeMock.mockRejectedValueOnce("DESKTOP_LOCAL_HOST_STORAGE_REJECTED");
    await expect(port.createDomainAsset(request)).rejects.toBe("DESKTOP_LOCAL_HOST_STORAGE_REJECTED");
    for (const foreign of [{ ...receipt, operation: "edit" }, { ...receipt, entityId: "other.test" }, { ...receipt, mutationId: "create-2" }]) {
      invokeMock.mockResolvedValueOnce(foreign);
      await expect(port.createDomainAsset(request)).rejects.toThrow();
    }
    // Only canonical domains reach the Host.
    invokeMock.mockClear();
    for (const entityId of ["Added.Test", "added.test.", "1.2.3", "https://added.test"]) {
      await expect(port.createDomainAsset({ ...request, asset: { ...request.asset, entityId } })).rejects.toThrow();
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reads DNS health windows through the narrow command and rejects hostile or foreign responses", async () => {
    const read = {
      schemaVersion: 1, kind: "dns_health", readGeneration: 3,
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 1, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      totalRows: 1,
      assetCount: 1,
      observedCount: 0,
      warningCount: 0,
      window: { startIndex: 0, size: 200, rows: [{ entityId: "example.test", bindable: false, zoneBinding: null, observation: null }] },
    };
    const port = createLocalDnsHealthPort();
    invokeMock.mockResolvedValueOnce(read);
    await expect(port.loadDnsHealth({ startIndex: 0, size: 200, query: "exa" })).resolves.toEqual(read);
    expect(invokeMock).toHaveBeenCalledWith("local_dns_health_read", { request: { startIndex: 0, size: 200, query: "exa" } });
    for (const hostile of [
      { ...read, token: "canary" },
      { ...read, freshness: { ...read.freshness, source: "standby_cloud", readOnlyReason: "standby", canEdit: false } },
      "LOCAL_READ_AUTHORIZATION_REQUIRED",
    ]) {
      if (typeof hostile === "string") invokeMock.mockRejectedValueOnce(hostile);
      else invokeMock.mockResolvedValueOnce(hostile);
      await expect(port.loadDnsHealth({ startIndex: 0, size: 200, query: "" })).rejects.toBeInstanceOf(LocalReadError);
    }
    invokeMock.mockClear();
    await expect(port.loadDnsHealth({ startIndex: 0, size: 201, query: "" })).rejects.toThrow("LOCAL_WINDOW_REJECTED");
    await expect(port.loadDnsHealth({ startIndex: 0, size: 10, query: "", workspaceId: "canary" } as never)).rejects.toThrow("LOCAL_WINDOW_REJECTED");
    await expect(port.loadDnsHealth({ startIndex: 0, size: 10, query: "\u0007" })).rejects.toThrow("LOCAL_WINDOW_REJECTED");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reads batch windows through the narrow command and rejects identifiers or foreign provenance", async () => {
    const row = {
      title: "Nameserver change", operationKind: "dns_change", planPhase: "planned", operationPhase: null, riskLevel: "high",
      itemCount: 1, targetCount: 1, createdAt: "2026-08-19T10:00:00Z", completedAt: null, providerKinds: ["cloudflare"],
      planned: { automatic: 1, manual: 0, unsupported: 0, conflict: 0, excluded: 0, highRisk: 1 }, results: null,
    };
    const read = {
      schemaVersion: 1, kind: "batch_operations", readGeneration: 3,
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 1, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      totalRows: 1,
      window: { startIndex: 0, size: 200, rows: [row] },
    };
    const port = createLocalBatchOperationsPort();
    invokeMock.mockResolvedValueOnce(read);
    await expect(port.loadBatchOperations({ startIndex: 0, size: 200 })).resolves.toEqual(read);
    expect(invokeMock).toHaveBeenCalledWith("local_batch_operations_read", { request: { startIndex: 0, size: 200 } });
    for (const hostile of [
      { ...read, window: { ...read.window, rows: [{ ...row, planId: "canary" }] } },
      { ...read, freshness: { ...read.freshness, source: "standby_cloud", readOnlyReason: "standby", canEdit: false } },
      "LOCAL_READ_AUTHORIZATION_REQUIRED",
    ]) {
      if (typeof hostile === "string") invokeMock.mockRejectedValueOnce(hostile);
      else invokeMock.mockResolvedValueOnce(hostile);
      await expect(port.loadBatchOperations({ startIndex: 0, size: 200 })).rejects.toBeInstanceOf(LocalReadError);
    }
    invokeMock.mockClear();
    await expect(port.loadBatchOperations({ startIndex: 0, size: 201 })).rejects.toThrow("LOCAL_WINDOW_REJECTED");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reads history windows through the narrow command and rejects identifiers or foreign provenance", async () => {
    const row = {
      localRevision: 4, entityId: "ledger.test", operation: "edit", committedAt: "2026-08-19T10:00:00Z", state: "pending",
      serverRevision: null, changes: [{ fieldPath: "note", value: "second", previousValue: "first" }],
    };
    const read = {
      schemaVersion: 1, kind: "history", readGeneration: 3,
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 1, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      totalRows: 1, pendingRows: 1, changesToday: 1,
      window: { startIndex: 0, size: 200, rows: [row] },
    };
    const port = createLocalHistoryPort();
    invokeMock.mockResolvedValueOnce(read);
    const day = { todayFrom: "2026-08-27T16:00:00Z", todayUntil: "2026-08-28T16:00:00Z" };
    await expect(port.loadHistory({ startIndex: 0, size: 200, ...day })).resolves.toEqual(read);
    expect(invokeMock).toHaveBeenCalledWith("local_history_read", { request: { startIndex: 0, size: 200, ...day } });
    for (const hostile of [
      { ...read, window: { ...read.window, rows: [{ ...row, mutationId: "canary" }] } },
      { ...read, window: { ...read.window, rows: [{ ...row, sourceDeviceId: "canary" }] } },
      { ...read, freshness: { ...read.freshness, source: "standby_cloud", readOnlyReason: "standby", canEdit: false } },
      "LOCAL_READ_AUTHORIZATION_REQUIRED",
    ]) {
      if (typeof hostile === "string") invokeMock.mockRejectedValueOnce(hostile);
      else invokeMock.mockResolvedValueOnce(hostile);
      await expect(port.loadHistory({ startIndex: 0, size: 200, ...day })).rejects.toBeInstanceOf(LocalReadError);
    }
    invokeMock.mockClear();
    await expect(port.loadHistory({ startIndex: 0, size: 201, ...day })).rejects.toThrow("LOCAL_WINDOW_REJECTED");
    await expect(port.loadHistory({ startIndex: 0, size: 200, todayFrom: day.todayFrom, todayUntil: day.todayFrom })).rejects.toThrow("LOCAL_WINDOW_REJECTED");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reads manual task windows through the narrow command and rejects identifiers, browser fields or foreign provenance", async () => {
    const row = {
      title: "Nameserver change", operationKind: "dns_change", capability: "dns_write", providerKind: "cloudflare", connectionLabel: "DNS",
      highRisk: false, itemCount: 1, waitingSince: "2026-08-19T10:00:00Z", lastObservedAt: null, domainCount: 1, domains: ["bravo.test"],
    };
    const read = {
      schemaVersion: 1, kind: "manual_tasks", readGeneration: 3,
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 1, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      totalRows: 1,
      window: { startIndex: 0, size: 200, rows: [row] },
    };
    const port = createLocalManualTasksPort();
    invokeMock.mockResolvedValueOnce(read);
    await expect(port.loadManualTasks({ startIndex: 0, size: 200 })).resolves.toEqual(read);
    expect(invokeMock).toHaveBeenCalledWith("local_manual_tasks_read", { request: { startIndex: 0, size: 200 } });
    for (const hostile of [
      { ...read, window: { ...read.window, rows: [{ ...row, operationId: "canary" }] } },
      { ...read, window: { ...read.window, rows: [{ ...row, remoteBrowserSession: "canary" }] } },
      { ...read, freshness: { ...read.freshness, source: "standby_cloud", readOnlyReason: "standby", canEdit: false } },
      "LOCAL_READ_AUTHORIZATION_REQUIRED",
    ]) {
      if (typeof hostile === "string") invokeMock.mockRejectedValueOnce(hostile);
      else invokeMock.mockResolvedValueOnce(hostile);
      await expect(port.loadManualTasks({ startIndex: 0, size: 200 })).rejects.toBeInstanceOf(LocalReadError);
    }
    invokeMock.mockClear();
    await expect(port.loadManualTasks({ startIndex: 0, size: 201 })).rejects.toThrow("LOCAL_WINDOW_REJECTED");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reads renewal windows through the narrow command and rejects identifiers or foreign provenance", async () => {
    const read = {
      schemaVersion: 1, kind: "renewals", readGeneration: 3,
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 1, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      asOfDate: "2026-08-20",
      totalRows: 1,
      autoRenewEnabledCount: 0,
      autoRenewDisabledCount: 1,
      window: { startIndex: 0, size: 200, rows: [{ entityId: "vault.io", expiresOn: "2026-08-27", autoRenew: false, registrarName: "Spaceship" }] },
    };
    const port = createLocalRenewalsPort();
    invokeMock.mockResolvedValueOnce(read);
    await expect(port.loadRenewals({ startIndex: 0, size: 200 })).resolves.toEqual(read);
    expect(invokeMock).toHaveBeenCalledWith("local_renewals_read", { request: { startIndex: 0, size: 200 } });
    for (const hostile of [
      { ...read, window: { ...read.window, rows: [{ ...read.window.rows[0], observationId: "canary" }] } },
      { ...read, freshness: { ...read.freshness, source: "standby_cloud", readOnlyReason: "standby", canEdit: false } },
      "LOCAL_READ_AUTHORIZATION_REQUIRED",
    ]) {
      if (typeof hostile === "string") invokeMock.mockRejectedValueOnce(hostile);
      else invokeMock.mockResolvedValueOnce(hostile);
      await expect(port.loadRenewals({ startIndex: 0, size: 200 })).rejects.toBeInstanceOf(LocalReadError);
    }
    invokeMock.mockClear();
    await expect(port.loadRenewals({ startIndex: 0, size: 201 })).rejects.toThrow("LOCAL_WINDOW_REJECTED");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reads sales windows through the narrow command and rejects identifiers or foreign provenance", async () => {
    const read = {
      schemaVersion: 1, kind: "sales", readGeneration: 3,
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 1, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      totalRows: 1, activeListingCount: 1, listedValue: null,
      window: { startIndex: 0, size: 200, rows: [{
        entityId: "vault.io", marketplaces: ["atom"], listingStatus: "active", askingPrice: null,
      }] },
    };
    const port = createLocalSalesPort();
    invokeMock.mockResolvedValueOnce(read);
    await expect(port.loadSales({ startIndex: 0, size: 200 })).resolves.toEqual(read);
    expect(invokeMock).toHaveBeenCalledWith("local_sales_read", { request: { startIndex: 0, size: 200 } });
    for (const hostile of [
      { ...read, window: { ...read.window, rows: [{ ...read.window.rows[0], listingObservationId: "canary" }] } },
      { ...read, freshness: { ...read.freshness, source: "standby_cloud", readOnlyReason: "standby", canEdit: false } },
      "LOCAL_READ_AUTHORIZATION_REQUIRED",
    ]) {
      if (typeof hostile === "string") invokeMock.mockRejectedValueOnce(hostile);
      else invokeMock.mockResolvedValueOnce(hostile);
      await expect(port.loadSales({ startIndex: 0, size: 200 })).rejects.toBeInstanceOf(LocalReadError);
    }
    invokeMock.mockClear();
    await expect(port.loadSales({ startIndex: 0, size: 201 })).rejects.toThrow("LOCAL_WINDOW_REJECTED");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reads settings through the narrow command and rejects identifiers or foreign provenance", async () => {
    const read = {
      schemaVersion: 2, kind: "settings", readGeneration: 3,
      storageIntegrity: { malformedExpiries: 0, invalidRegistrarObservations: 0, rejectedDnsRows: 0, rejectedListings: 0, malformedOutboxRows: 0 },
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 1, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      connections: [{
        providerKind: "cloudflare", connectionLabel: "Cloudflare", lifecycleStatus: "active", validationStatus: "valid",
        credentialUseState: "active", lastValidatedAt: null,
        roles: [{ role: "dns", availability: "unavailable", unavailableReason: "qualification_pending" }],
      }],
    };
    const port = createLocalSettingsPort();
    invokeMock.mockResolvedValueOnce(read);
    await expect(port.loadSettings()).resolves.toEqual(read);
    expect(invokeMock).toHaveBeenCalledWith("local_settings_read");
    for (const hostile of [
      { ...read, connections: [{ ...read.connections[0], connectionId: "canary" }] },
      { ...read, freshness: { ...read.freshness, source: "standby_cloud", readOnlyReason: "standby", canEdit: false } },
      "LOCAL_READ_AUTHORIZATION_REQUIRED",
    ]) {
      if (typeof hostile === "string") invokeMock.mockRejectedValueOnce(hostile);
      else invokeMock.mockResolvedValueOnce(hostile);
      await expect(port.loadSettings()).rejects.toBeInstanceOf(LocalReadError);
    }
  });

  it("reads the Active lease for display and rejects anything beyond the identifiers", async () => {
    invokeMock.mockResolvedValueOnce({ schemaVersion: 1, deviceId: "device-01HZX", leaseEpoch: 3 });
    await expect(createLocalDeviceLeasePort().read()).resolves.toEqual({ schemaVersion: 1, deviceId: "device-01HZX", leaseEpoch: 3 });
    expect(invokeMock).toHaveBeenLastCalledWith("local_device_lease_read");

    for (const response of [
      { schemaVersion: 2, deviceId: "device-01HZX", leaseEpoch: 3 },
      { schemaVersion: 1, deviceId: "device 01", leaseEpoch: 3 },
      { schemaVersion: 1, deviceId: "", leaseEpoch: 3 },
      { schemaVersion: 1, deviceId: "d".repeat(129), leaseEpoch: 3 },
      { schemaVersion: 1, deviceId: "device-01HZX", leaseEpoch: 0 },
      { schemaVersion: 1, deviceId: "device-01HZX", leaseEpoch: 2 ** 53 },
      { schemaVersion: 1, deviceId: "device-01HZX", leaseEpoch: 3, envelope: "signed" },
      null,
    ]) {
      invokeMock.mockResolvedValueOnce(response);
      await expect(createLocalDeviceLeasePort().read()).rejects.toThrow(TypeError);
    }
    invokeMock.mockRejectedValueOnce("LOCAL_LEASE_UNAVAILABLE");
    await expect(createLocalDeviceLeasePort().read()).rejects.toBe("LOCAL_LEASE_UNAVAILABLE");
  });

  it("accepts only the closed schema-v2 retryable lock fixture", async () => {
    invokeMock.mockResolvedValueOnce({
      schemaVersion: 2,
      state: "retryable_locked",
      capabilities: [],
      readGeneration: 9,
    });

    await expect(createLocalBusinessPort().status()).resolves.toEqual({
      schemaVersion: 2,
      state: "retryable_locked",
      capabilities: [],
      readGeneration: 9,
    });

    for (const response of [
      {
        schemaVersion: 1,
        state: "retryable_locked",
        capabilities: [],
        readGeneration: 9,
      },
      {
        schemaVersion: 2,
        state: "retryable_locked",
        capabilities: ["local:read"],
        readGeneration: 9,
      },
    ]) {
      invokeMock.mockResolvedValueOnce(response);
      await expect(createLocalBusinessPort().status()).rejects.toThrow(
        "invalid local business",
      );
    }
  });
});
