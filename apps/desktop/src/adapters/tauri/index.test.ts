import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { createLocalBusinessPort } from "./index";

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
