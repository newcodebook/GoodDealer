import type {
  CloudflareConnectionStatus,
  CloudflareObservation,
  CloudflarePort,
} from "../../adapters/tauri";

export type CloudflareJourneyState =
  | { readonly state: "loading" }
  | { readonly state: "not-configured" }
  | { readonly state: "recovering" | "busy" | "blocked" }
  | { readonly state: "ready"; readonly status: CloudflareConnectionStatus }
  | { readonly state: "observing"; readonly status: CloudflareConnectionStatus }
  | { readonly state: "available" | "empty"; readonly status: CloudflareConnectionStatus; readonly observation: CloudflareObservation }
  | { readonly state: "stale" | "uncertain"; readonly status: CloudflareConnectionStatus; readonly observation: CloudflareObservation }
  | { readonly state: "unavailable"; readonly status: CloudflareConnectionStatus | null };

export interface CloudflareJourney {
  readonly current: () => CloudflareJourneyState;
  readonly start: () => Promise<CloudflareJourneyState>;
  readonly activate: (connectionRef: string) => Promise<CloudflareJourneyState>;
  readonly observe: (connectionRef: string, entityId: string) => Promise<CloudflareJourneyState>;
  readonly invalidate: () => void;
  readonly unmount: () => void;
}

/** Coordinates Native calls and drops completions from an older route/lock generation. */
export function createCloudflareJourney(
  port: CloudflarePort,
  accept: (state: CloudflareJourneyState) => void,
  wait: () => Promise<void> = () => new Promise((resolve) => window.setTimeout(resolve, 250)),
): CloudflareJourney {
  let generation = 0;
  let mounted = true;
  let state: CloudflareJourneyState = { state: "loading" };
  let activationInFlight: Promise<CloudflareJourneyState> | null = null;
  const publish = (next: CloudflareJourneyState, token: number) => {
    if (!mounted || token !== generation) return state;
    state = next;
    accept(next);
    return next;
  };
  const readStatus = async (token: number): Promise<CloudflareJourneyState> => {
    try {
      const status = await port.status();
      if (status.state === "not-configured" || status.state === "recovering" || status.state === "busy" || status.state === "blocked") {
        return publish({ state: status.state }, token);
      }
      return publish({ state: "ready", status }, token);
    } catch {
      return publish({ state: "unavailable", status: null }, token);
    }
  };
  const convergeStatus = async (token: number): Promise<CloudflareJourneyState> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (!mounted || token !== generation) return state;
      const next = await readStatus(token);
      if (next.state === "ready" || next.state === "blocked" || next.state === "not-configured" || next.state === "unavailable") return next;
      await wait();
    }
    return publish({ state: "unavailable", status: null }, token);
  };
  return {
    current: () => state,
    async start() {
      const token = ++generation;
      publish({ state: "loading" }, token);
      return readStatus(token);
    },
    async activate(connectionRef) {
      if (activationInFlight !== null) return activationInFlight;
      if (state.state !== "not-configured") return state;
      const token = ++generation;
      publish({ state: "loading" }, token);
      activationInFlight = (async () => {
        try {
          await port.activate(connectionRef);
          return await convergeStatus(token);
        } catch {
          return publish({ state: "unavailable", status: null }, token);
        } finally {
          activationInFlight = null;
        }
      })();
      return activationInFlight;
    },
    async observe(connectionRef, entityId) {
      const token = ++generation;
      const status = state.state === "ready" ? state.status : null;
      if (status === null || status.state !== "ready") return publish({ state: "unavailable", status }, token);
      publish({ state: "observing", status }, token);
      try {
        await port.observe(connectionRef, entityId);
        // Host observation commit is complete before this read is allowed to publish.
        const observation = await port.readObservation(entityId);
        if (observation.readGeneration !== status.readGeneration || observation.entityId !== entityId) {
          return publish({ state: "unavailable", status }, token);
        }
        if (observation.availability !== "available") return publish({ state: "unavailable", status }, token);
        if (observation.uncertainty === "stale") return publish({ state: "stale", status, observation }, token);
        if (observation.uncertainty !== "confirmed") return publish({ state: "uncertain", status, observation }, token);
        return publish({ state: observation.records.length === 0 ? "empty" : "available", status, observation }, token);
      } catch {
        return publish({ state: "unavailable", status }, token);
      }
    },
    invalidate() {
      generation += 1;
      state = { state: "unavailable", status: null };
      if (mounted) accept(state);
    },
    unmount() {
      generation += 1;
      mounted = false;
    },
  };
}
