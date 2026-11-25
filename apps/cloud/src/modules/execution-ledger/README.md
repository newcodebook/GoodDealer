# Execution fact evidence

`PostgresExecutionFactEvidenceService` accepts the existing execution_fact v1 envelope only for
Afternic `dispatch_claimed` / `durable_local_claim`. It independently verifies the original signed
item approval against its own historical context, immutable batch approval and paired claim audit.
A refreshed dispatch context is allowed within the same source/Lease/credential/key domain; scope
changes are not authorized. The local dispatch digest commits the actual plan ID and does not
claim Provider idempotency or that HTTP bytes were sent.

The existing `execution_fact_drain_records` owns accepted evidence and its original exact receipt.
The same existing head lock serializes append and seal. Exact accepted retries remain successful
after sealing; new/mutated events are quarantined. A single durable attempt, paired audit or fact ID
cannot acquire another accepted record by changing the sequence or epoch. Source-wide unique
constraints arbitrate concurrent domains; only their named uniqueness violations are converted to
replay quarantine. Other database errors propagate and roll back.

Quarantine retains safe identity/digest/reason only and cannot acknowledge a local outbox event.
Signed semantic violations before sealing block the first seal. Invalid signatures cannot poison a
drain domain, and a rejection arriving after an accepted seal never invalidates that seal. Rejected
seal attempts roll back derived head placeholders as well as partial seals. The module exposes an
immutable fact reader for Audit reconciliation; no other module reads its repository directly.
