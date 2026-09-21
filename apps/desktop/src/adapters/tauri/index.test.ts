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
