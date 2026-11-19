import { beforeEach, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { createAfternicPort } from "./afternic";
beforeEach(() => invoke.mockReset());
it("sends only bounded raw intent and refuses unknown Host responses", async () => {
  invoke.mockResolvedValue(null);
  const port=createAfternicPort(); await port.connect("Inventory");
  expect(invoke.mock.calls[0]?.[0]).toBe("afternic_connection_connect");
  expect(JSON.parse(new TextDecoder().decode(invoke.mock.calls[0]?.[1]))).toEqual({schemaVersion:1,displayLabel:"Inventory"});
  await expect(port.refresh("not-an-id")).rejects.toThrow(); expect(invoke).toHaveBeenCalledTimes(1);
  await expect(port.status()).rejects.toThrow();
});
