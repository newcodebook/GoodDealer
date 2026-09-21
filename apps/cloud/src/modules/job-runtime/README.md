# Job Runtime

## Role

Cloud infrastructure capability for durable job envelopes, leases, idempotency, quarantine, and replay control.

## Owns

- Generic persistence and lifecycle contracts for future tenant-scoped jobs.
- Registration and dispatch of the fixed periodic commercial-job allowlist.

## Touchpoints

- Dispatches the five composed periodic jobs through narrow Licensing-owned ports.
- Uses Cloud database infrastructure for persistence without owning pools or migration execution.
- Requires each target capability to own payload meaning, authorization, results, and side effects.

## Change Guide

- Add a job kind only with an identified capability owner, strict schema, trusted scope, and idempotency rules.
- Keep arbitrary payload interpretation, credentials, and external execution out of this module.
- Verify persistence, job composition, and repository policy tests when the allowlist or lifecycle changes.

## Purpose

The job-runtime module owns future tenant job-envelope persistence, lease timing, idempotency,
quarantine, and controlled replay contracts. Target capabilities must own payload meaning,
authorization revalidation, business results, cancellation, compensation, and external side-effect
semantics.

## Principles

- MUST: Derive future tenant scope from a trusted transaction boundary, never caller-selected data.
- MUST: Preserve immutable canonical request bytes and bounded digests across retry, conflict, and quarantine handling.
- MUST: Let the target capability own payload decoding, authorization, result handling, and any external idempotency contract.
- MUST: Keep generic job-runtime payload interpretation out of production composition. The only periodic definitions are the five narrow Licensing-owned commercial jobs: provider operation, provider inbox, reconciliation, due authority, and provider release.

## Boundaries

- Does NOT handle: Public business HTTP routes, admin business routes, Desktop composition, credentials, network calls, or provider execution. (see: ../../entrypoints/routes/public/boundary.ts)
- Does NOT handle: A generic background executor capable of interpreting arbitrary payloads. (see: postgres-job-runtime.ts)
- Does NOT handle: Pool ownership or generic migration execution; those remain in Cloud database infrastructure. (see: ../../db/index.ts)

## Adversarial Surfaces

- **Tenant substitution**: Tenant authority must be derived from the trusted transaction boundary. Verified by: job-runtime persistence tests.
- **Replay substitution**: A future replay path must retain original canonical bytes and resolve authorization through the owning target capability. Verified by: job-runtime persistence tests.
- **Composition bypass**: The exact periodic-job allowlist and narrow application ports prevent an arbitrary payload executor from reaching production composition. Verified by: `../../../../../scripts/jobs-evidence-policy.test.mjs` and `../../../test/entrypoints/jobs-composition.test.ts`.

## Contracts

- **PersistentJobCreateRequest** (defined in: ../../../../../packages/protocol/src/jobs/persistent-create.ts): strict future create input. Consumers: postgres-job-runtime.ts, ../../../test/postgres/job-runtime-persistence.test.ts.
- **JobKindDefinition** (defined in: postgres-job-runtime.ts): target-owned payload, partition, and authorization contract. Consumers: ../../../test/postgres/job-runtime-persistence.test.ts.

## Open Questions

- [ ] Which production hosts, failover topology, monitoring thresholds and workload credentials will qualify the self-managed scheduler and worker? (open since: 2026-09)

## Current composition

`periodicJobs` contains exactly `commercial-provider-operation`, `commercial-provider-inbox`,
`commercial-provider-reconciliation`, `commercial-due-authority`, and
`commercial-provider-release`, all targeting Licensing once per minute.
`createJobsComposition()` remains framework-independent: startup registers those definitions through
`JobSchedulerPort`, and execution calls only the corresponding narrow `CommercialProviderJobPort`
method with a worker identity. Missing dependencies,
denied scheduling, invalid time, and execution before startup fail closed.

## Future integration contract

Any additional job kind needs a specific owning capability, strict input schema, trusted tenant boundary,
authorization revalidation, immutable request semantics, idempotency rules, quarantine behavior,
and negative tests. Only then may an application owner decide whether to compose it into a scheduler.

Repository evidence establishes the five job definitions and dispatch contract. The shared development
systemd worker additionally establishes bounded execution in that one environment; neither establishes
production scheduler/worker qualification, a live provider result, or Gate closure.
