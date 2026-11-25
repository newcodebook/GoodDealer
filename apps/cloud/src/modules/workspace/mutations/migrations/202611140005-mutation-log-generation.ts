import type { CloudMigration } from "../../../../db/index";

/**
 * ADR-0029 decision 3, C2a: the mutation log records the entity generation each accepted mutation
 * named and, for a re-add, the deletion revision it superseded, so pull pages, replay, drain
 * envelopes and checkpoint rebuild report what was accepted instead of assuming generation 1.
 * Every row already stored is generation 1 without a re-add, because the ingest refused anything
 * else until this change, so the defaults are exact. The checks repeat the wire rule: only an
 * upsert re-adds, it names a later generation, and it builds on the deletion it supersedes. The
 * application role keeps its table-level INSERT and still has no UPDATE, so stored rows stay
 * immutable.
 */
export const mutationLogGenerationMigration: CloudMigration = {
  id: "202611140005-mutation-log-generation",
  owner: "workspace/mutations",
  sql: `
    ALTER TABLE workspace_mutations
      ADD COLUMN entity_generation bigint NOT NULL DEFAULT 1
        CONSTRAINT workspace_mutations_entity_generation_check
        CHECK (entity_generation BETWEEN 1 AND 9007199254740991),
      ADD COLUMN re_adds_deleted_revision bigint
        CONSTRAINT workspace_mutations_re_adds_deleted_revision_check
        CHECK (
          re_adds_deleted_revision IS NULL
          OR (
            operation_kind = 'upsert'
            AND entity_generation >= 2
            AND re_adds_deleted_revision BETWEEN 1 AND base_server_revision
          )
        );
  `,
};
