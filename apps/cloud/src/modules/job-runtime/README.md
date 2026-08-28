# Job Runtime

## Purpose

The job-runtime module owns future tenant job-envelope persistence, lease timing, idempotency,
quarantine, and controlled replay contracts. Target capabilities must own payload meaning,
authorization revalidation, business results, cancellation, compensation, and external side-effect
semantics.

## Principles

- MUST: Derive future tenant scope from a trusted transaction boundary, never caller-selected data.
- MUST: Preserve immutable canonical request bytes and bounded digests across retry, conflict, and quarantine handling.
- MUST: Let the target capability own payload decoding, authorization, result handling, and any external idempotency contract.
- MUST: Keep production definitions, application ports, scheduler composition, and periodic jobs empty until a concrete target capability is approved and composed.

## Boundaries

- Does NOT handle: Public business HTTP routes, admin business routes, Desktop composition, credentials, network calls, or provider execution. (see: ../../entrypoints/routes/public/boundary.ts)
- Does NOT handle: A generic background executor capable of interpreting arbitrary payloads. (see: postgres-job-runtime.ts)
- Does NOT handle: Pool ownership or generic migration execution; those remain in Cloud database infrastructure. (see: ../../db/index.ts)

## Adversarial Surfaces

- **Tenant substitution**: Tenant authority must be derived from the trusted transaction boundary. Verified by: job-runtime persistence tests.
- **Replay substitution**: A future replay path must retain original canonical bytes and resolve authorization through the owning target capability. Verified by: job-runtime persistence tests.
- **Composition bypass**: Empty production registries prevent implicit scheduling. Verified by: `../../../../../scripts/jobs-persistence-evidence-policy.test.mjs`.

## Contracts

- **PersistentJobCreateRequest** (defined in: ../../../../../packages/protocol/src/jobs/persistent-create.ts): strict future create input. Consumers: postgres-job-runtime.ts, ../../../test/postgres/job-runtime-persistence.test.ts.
- **JobKindDefinition** (defined in: postgres-job-runtime.ts): target-owned payload, partition, and authorization contract. Consumers: ../../../test/postgres/job-runtime-persistence.test.ts.

## Open Questions

- [ ] Which target capability, scheduler owner, and deployment composition will approve the first production job kind? (open since: 2026-08)

## Current composition

`periodicJobs` is an exact empty tuple. `createJobsComposition()` returns a framework-independent
composition with `periodicJobsRegistered: false` and does not call a scheduler. No production job
definition or handler is registered.

## Future integration contract

A future job kind needs a specific owning capability, strict input schema, trusted tenant boundary,
authorization revalidation, immutable request semantics, idempotency rules, quarantine behavior,
and negative tests. Only then may an application owner decide whether to compose it into a scheduler.

Repository evidence does not establish a deployed scheduler, a production job, a provider result,
or Gate closure.
