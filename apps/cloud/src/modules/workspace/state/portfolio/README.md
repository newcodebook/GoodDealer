# Workspace portfolio state

## Purpose

This module owns tenant-keyed PostgreSQL sync replicas of allowlisted business fields and the
recovery projection consumed only to rebuild a local SQLCipher workspace. Revision
allocation, tenant-scope derivation, wire protocol definitions, routing, and provider
observation writes belong to other modules.

## Principles

- MUST: Parse every selected database row from `unknown` with its exact snake-case shape.
- MUST: Bind both tenant coordinates on every portfolio read and keep the complete read in one read-only, repeatable-read transaction.
- MUST: Persist unavailable/unknown defaults until an authoritative owner establishes an observation; replica row existence alone cannot claim availability.
- MUST: Keep recovery read-only, host-independent, and outside Desktop's normal Query path.
- MUST: Never accept Provider account identity, labels, credential bindings, or secrets.
- MUST: Use `workspace_replica_*` final table names so database semantics cannot imply Desktop Repository ownership.
- MUST: Deny application-role hard deletes, and keep future replica families read-only until strict wire schemas, materializers, tombstone semantics, and recovery tests exist.
- MUST: Grant application writes by column; current fields and server revisions cannot authorize future lifecycle or materialization columns.

## Boundaries

- Does NOT handle: Tenant-scope derivation, wire schema ownership, routes, or Cloud-client composition. (see: `../../tenant-scope.ts`, `../../../../../../../packages/protocol/src/workspace/workspace-read.ts`)
- Does NOT handle: Revision allocation or mutation-log ownership. (see: `../../revisions/index.ts`, `../../mutations/index.ts`)
- Does NOT handle: Provider calls, credentials, import/batch execution, or public mutation authority. (see: `postgres-repository.ts`)
- Does NOT handle: Central migration ordering or checksum registration. (see: `../../../../../db/migrations.ts`)

## Adversarial Surfaces

- **caller-scope-injection**: Wire data cannot construct, select, or echo a tenant; trusted scope and the strict empty request are parsed before access. Verified by: `../../../../../test/workspace-portfolio-read.test.ts`.
- **dual-key-sql-substitution**: Portfolio reads must bind the transaction's account and workspace coordinates on every statement. Verified by: `../../../../../test/workspace-portfolio-read-persistence.test.ts`.
- **forced-rls-pooled-session-leakage**: Both portfolio tables use forced dual-key RLS and transaction-local selectors must disappear on pooled connection reuse. Verified by: `../../../../../test/postgres/workspace-portfolio-read-persistence.test.ts`.
- **untrusted-database-rows**: Unknown columns, malformed scalar values, partial money fields, invalid state combinations, and noncanonical timestamps or versions fail closed. Verified by: `../../../../../test/workspace-portfolio-read-persistence.test.ts`.
- **strict-final-response**: The service parses the complete frozen response after the repository returns and rejects tenant echoes, extra fields, invalid ordering, and invalid materialization or projection state. Verified by: `../../../../../test/workspace-portfolio-read.test.ts`.
- **cross-table-snapshot-mixing**: Assets and projection state are read once within the same read-only repeatable-read transaction. Verified by: `../../../../../test/workspace-portfolio-read-persistence.test.ts`.
- **accidental-write-authority**: The read service and projection query expose no write operation and the database transaction rejects writes. Verified by: `../../../../../test/postgres/workspace-portfolio-read-persistence.test.ts`.

## Open Questions

- [x] No unresolved questions for the current read-only portfolio replica projection. (open since: 2026-08)

## Runtime contracts

- `PortfolioProjectionQueryPort` accepts only a trusted `WorkspaceTenantScope` and returns
  an unknown value so the service remains responsible for final frozen-response parsing.
- `PostgresPortfolioProjectionQuery` reads asset and projection-state rows in one
  read-only, repeatable-read transaction. Every statement binds both `account_id` and
  `workspace_id`; database rows are untrusted until their exact snake-case shapes and
  protocol values are parsed.
- `PostgresPortfolioRepository` remains the internal sync/checkpoint replica
  boundary. The recovery path adds no normal Desktop Query route, import/batch API, provider call, or public
  mutation authority.
- M002 directly creates the final `workspace_replica_*` schema with honest projection defaults
  (`unavailable` / `unknown` with no observation time), one projection-state row per workspace
  head, and allowlisted lifecycle, observation, operation-summary, history, DNS, and tombstone
  storage without Provider connection identity.
- Schema presence reserves the reviewed future shape; it is not runtime write authorization. Only
  the currently owned DomainAsset/Portfolio State path has application-role DML, without `DELETE`.

## Migration integration boundary

M002 is registered as the literal second entry in `apps/cloud/src/db/migrations.ts`. The central
catalog and PostgreSQL migration tests consume that production ordering and its literal
checksum; this module continues to own the migration source rather than catalog policy.
