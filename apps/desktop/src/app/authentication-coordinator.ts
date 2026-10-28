import type { DesktopAuthenticationStatus } from "../adapters/tauri";

export async function synchronizeAfterAuthentication(
  status: DesktopAuthenticationStatus,
  synchronize: () => Promise<void>,
): Promise<void> {
  if (
    status === "authenticated"
    || status === "authorization_failed"
    || status === "authorization_retryable"
  ) await synchronize();
}

/** Native has already removed read authority for these events; the Renderer must evict at once. */
export function authenticationLocksRuntime(status: DesktopAuthenticationStatus): boolean {
  return status === "authorization_failed" || status === "authorization_retryable";
}

export interface AuthenticationStatusCoordinator {
  acceptEvent(status: DesktopAuthenticationStatus): Promise<void>;
  beginSnapshot(): (status: DesktopAuthenticationStatus) => Promise<void>;
}

/**
 * Closes the startup race between subscribing to status events and reading the current status:
 * a snapshot taken before a newer event is discarded instead of overwriting it.
 */
export function createAuthenticationStatusCoordinator(
  accept: (status: DesktopAuthenticationStatus) => Promise<void>,
): AuthenticationStatusCoordinator {
  let eventGeneration = 0;
  return {
    async acceptEvent(status) {
      eventGeneration += 1;
      await accept(status);
    },
    beginSnapshot() {
      const generation = eventGeneration;
      return async (status) => {
        if (generation === eventGeneration) await accept(status);
      };
    },
  };
}
