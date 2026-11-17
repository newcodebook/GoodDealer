/* ADR-0032 S2b: the stop-write barrier of a device-switch drain. While a barrier row exists, this
   device cannot assign another device mutation sequence or add an Outbox row, so the drain proof
   it signs covers every mutation it will ever have sent under this Lease. The barrier lives in the
   encrypted database rather than in memory so that a restart mid-drain keeps writes closed; it is
   enforced by triggers at the only two points every writer (edits, conflict resolutions, Provider
   imports, backup restore) must pass, so no future writer can bypass it. Only the Host's drain
   coordinator opens and clears it: clearing happens when the switch is cancelled or fails, or
   after Cloud has handed the Lease to the target device and this device no longer writes. */
CREATE TABLE device_handoff_barriers (
    workspace_id TEXT NOT NULL PRIMARY KEY,
    device_switch_request_id TEXT NOT NULL CHECK (
      length(device_switch_request_id) BETWEEN 1 AND 200
      AND device_switch_request_id NOT GLOB '*[^!-~]*'
    ),
    began_at TEXT NOT NULL CHECK (began_at = strftime('%Y-%m-%dT%H:%M:%SZ', began_at)),
    FOREIGN KEY (workspace_id) REFERENCES active_workspace_metadata(workspace_id) ON DELETE CASCADE
  ) STRICT;

/* A barrier names one switch for its whole life; a new switch needs the old barrier cleared. */
CREATE TRIGGER device_handoff_barriers_immutable_update
BEFORE UPDATE ON device_handoff_barriers
BEGIN
  SELECT RAISE(ABORT, 'a device handoff barrier is immutable');
END;

CREATE TRIGGER device_handoff_barrier_closes_device_sequence
BEFORE UPDATE OF next_device_mutation_sequence ON active_workspace_metadata
WHEN NEW.next_device_mutation_sequence IS NOT OLD.next_device_mutation_sequence
  AND EXISTS (SELECT 1 FROM device_handoff_barriers WHERE workspace_id = OLD.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'a device handoff barrier closes local mutation admission');
END;

CREATE TRIGGER device_handoff_barrier_closes_outbox
BEFORE INSERT ON sync_outbox
WHEN EXISTS (SELECT 1 FROM device_handoff_barriers WHERE workspace_id = NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'a device handoff barrier closes local mutation admission');
END;
