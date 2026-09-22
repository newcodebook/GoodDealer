import type {
  IdentityBoundaryObservation,
  IdentityBoundaryObserver,
  IdentityBoundaryOperation,
} from "./identity-http";

export interface IdentityTelemetryRecord extends IdentityBoundaryObservation {
  readonly event: "identity_boundary";
  readonly observedAt: string;
}

/**
 * Emits only closed operation/outcome labels and keeps in-process counters for the metrics adapter.
 * Email, account, session, address, credentials, and request bodies are intentionally unrepresentable.
 */
export class IdentityBoundaryTelemetry implements IdentityBoundaryObserver {
  readonly #counts = new Map<string, number>();

  constructor(
    private readonly write: (record: IdentityTelemetryRecord) => void | Promise<void>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async observe(event: IdentityBoundaryObservation): Promise<void> {
    const key = `${event.operation}:${event.outcome}`;
    this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1);
    await this.write({ event: "identity_boundary", ...event, observedAt: canonicalSecond(this.now()) });
  }

  count(operation: IdentityBoundaryOperation, outcome: IdentityBoundaryObservation["outcome"]): number {
    return this.#counts.get(`${operation}:${outcome}`) ?? 0;
  }
}

function canonicalSecond(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new TypeError("identity telemetry time is invalid");
  return value.toISOString().replace(/\.\d{3}Z$/u, "Z");
}
