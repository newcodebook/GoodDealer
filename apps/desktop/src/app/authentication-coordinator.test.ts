import { describe, expect, it, vi } from "vitest";

import {
  authenticationLocksRuntime,
  createAuthenticationStatusCoordinator,
  synchronizeAfterAuthentication,
} from "./authentication-coordinator";

describe("Desktop authentication coordination", () => {
  it("reloads the activated local workspace after Native reports authenticated", async () => {
    const synchronize = vi.fn(async () => undefined);

    await synchronizeAfterAuthentication("authenticated", synchronize);

    expect(synchronize).toHaveBeenCalledOnce();
  });

  it("reloads locked local business state for retryable authorization changes", async () => {
    const synchronize = vi.fn(async () => undefined);

    await synchronizeAfterAuthentication("authorization_retryable", synchronize);

    expect(synchronize).toHaveBeenCalledOnce();
  });

  it("classifies both Native lock events for immediate Portfolio eviction", () => {
    expect(authenticationLocksRuntime("authorization_failed")).toBe(true);
    expect(authenticationLocksRuntime("authorization_retryable")).toBe(true);
    expect(authenticationLocksRuntime("authenticated")).toBe(false);
  });

  it("discards an older authentication snapshot after a newer event arrives", async () => {
    const accepted: string[] = [];
    const statuses = createAuthenticationStatusCoordinator(async (status) => {
      accepted.push(status);
    });
    const acceptSnapshot = statuses.beginSnapshot();

    await statuses.acceptEvent("authenticated");
    await acceptSnapshot("pending");

    expect(accepted).toEqual(["authenticated"]);
  });

  it("accepts the subscribed authentication snapshot when no event supersedes it", async () => {
    const accepted: string[] = [];
    const statuses = createAuthenticationStatusCoordinator(async (status) => {
      accepted.push(status);
    });
    const acceptSnapshot = statuses.beginSnapshot();

    await acceptSnapshot("signed_out");

    expect(accepted).toEqual(["signed_out"]);
  });
});
