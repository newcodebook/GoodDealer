/* ADR-0032 S2d: a barrier records the Lease epoch it was opened under. If this device later holds
   the Lease again it does so under a newer epoch, which means the switch that opened the barrier has
   ended (its handoff released that Lease); the Host can then recognise the barrier as left over and
   clear it instead of keeping writes silently closed. Every barrier the Host opens carries its
   epoch; the column is nullable only because SQLite cannot add a NOT NULL column without a default,
   and a barrier without an epoch is treated as left over. */
ALTER TABLE device_handoff_barriers ADD COLUMN active_lease_epoch INTEGER CHECK (
  active_lease_epoch IS NULL OR active_lease_epoch BETWEEN 1 AND 9007199254740991
);
