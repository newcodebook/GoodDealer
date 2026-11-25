/* ADR-0031 R2: an Outbox row written before the integrity triggers can carry a commit time that is
   not canonical UTC seconds, which fails the history read closed. The Outbox is this device's
   change ledger, and an acknowledged row is synced history, so the time is never rewritten. A mark
   records that the stored time is invalid; the history read then shows the row with no time. The
   mark keeps only a SHA-256 of the stored value, is immutable, and is admitted only for a row whose
   time is malformed by the history read's own predicate. */
CREATE TABLE sync_outbox_commit_time_marks (
    workspace_id TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    prior_value_sha256 TEXT NOT NULL CHECK (
      length(prior_value_sha256) = 64 AND prior_value_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    marked_at TEXT NOT NULL CHECK (marked_at = strftime('%Y-%m-%dT%H:%M:%SZ', marked_at)),
    PRIMARY KEY (workspace_id, mutation_id),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id) ON DELETE CASCADE
  ) STRICT;

CREATE TRIGGER sync_outbox_commit_time_marks_immutable_update
BEFORE UPDATE ON sync_outbox_commit_time_marks
BEGIN
  SELECT RAISE(ABORT, 'an Outbox commit time mark is immutable');
END;

CREATE TRIGGER sync_outbox_commit_time_marks_immutable_delete
BEFORE DELETE ON sync_outbox_commit_time_marks
BEGIN
  SELECT RAISE(ABORT, 'an Outbox commit time mark is immutable');
END;

CREATE TRIGGER sync_outbox_commit_time_marks_name_a_malformed_time
BEFORE INSERT ON sync_outbox_commit_time_marks
WHEN NOT EXISTS (
  SELECT 1 FROM sync_outbox
  WHERE workspace_id = NEW.workspace_id AND mutation_id = NEW.mutation_id
    AND (created_at IS NOT strftime('%Y-%m-%dT%H:%M:%SZ', created_at)
         OR substr(created_at, 12, 2) > '23')
)
BEGIN
  SELECT RAISE(ABORT, 'an Outbox commit time mark must name a malformed commit time');
END;
