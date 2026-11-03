import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { createLocalBusinessPort, createLocalDnsHealthPort, LocalReadError } from "./index";

describe("Desktop Tauri local-business adapter", () => {
  beforeEach(() => {
    invokeMock.mockReset();
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

  it("reads DNS health windows through the narrow command and rejects hostile or foreign responses", async () => {
    const read = {
      schemaVersion: 1, kind: "dns_health", readGeneration: 3,
      freshness: { source: "active_local", readOnlyReason: null, serverRevision: 1, lastReplicationActivityAt: null, lastSuccessfulProviderObservationAt: null, canEdit: true },
      totalRows: 1,
      window: { startIndex: 0, size: 200, rows: [{ entityId: "example.test", zoneBinding: null, observation: null }] },
    };
    const port = createLocalDnsHealthPort();
    invokeMock.mockResolvedValueOnce(read);
    await expect(port.loadDnsHealth({ startIndex: 0, size: 200 })).resolves.toEqual(read);
    expect(invokeMock).toHaveBeenCalledWith("local_dns_health_read", { request: { startIndex: 0, size: 200 } });
    for (const hostile of [
      { ...read, token: "canary" },
      { ...read, freshness: { ...read.freshness, source: "standby_cloud", readOnlyReason: "standby", canEdit: false } },
      "LOCAL_READ_AUTHORIZATION_REQUIRED",
    ]) {
      if (typeof hostile === "string") invokeMock.mockRejectedValueOnce(hostile);
      else invokeMock.mockResolvedValueOnce(hostile);
      await expect(port.loadDnsHealth({ startIndex: 0, size: 200 })).rejects.toBeInstanceOf(LocalReadError);
    }
    invokeMock.mockClear();
    await expect(port.loadDnsHealth({ startIndex: 0, size: 201 })).rejects.toThrow("LOCAL_WINDOW_REJECTED");
    await expect(port.loadDnsHealth({ startIndex: 0, size: 10, workspaceId: "canary" } as never)).rejects.toThrow("LOCAL_WINDOW_REJECTED");
    expect(invokeMock).not.toHaveBeenCalled();
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
