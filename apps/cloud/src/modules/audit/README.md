# Device execution audit

`PostgresDeviceAuditEvidenceService` accepts only the closed Afternic approval, durable dispatch
claim, preflight-refusal and current-authority reconciliation forms. It validates the historical
context through Devices, the device signature and independent audit hash/domain, then appends to
`workspace_device_audit_drain_records` under its existing domain lock. The immutable row owns the
original accepted receipt. The new quarantine table stores only safe identity/digest/reason metadata;
valid-device-signature semantic violations before a seal block that domain's first seal.

`PostgresDeviceAuditEvidenceReader` is the declared immutable approval/paired-audit read port for
execution-ledger. Reconciliation reads the original fact through execution-ledger's port and can
refer to an older Lease epoch on the same source device. It cannot re-sign an old response or create
a new claim. Missing prerequisites return pending without occupying a sequence; an unknown HTTP
response is resolved by exact receipt lookup or retrying the same envelope.

The original v1 audit envelope and server-audit substrate are unchanged. The generic in-memory
ledger remains a test model; production evidence admission uses the credential-bound service.
