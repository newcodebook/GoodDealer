import type { CloudMigration } from "../../../db/index";

/** Durable original responses make lost acknowledgements observable without minting new authority. */
export const targetBootstrapInstallationMigration: CloudMigration = {
  id: "202611190022-target-bootstrap-installation",
  owner: "devices",
  sql: `
ALTER TABLE device_bootstrap_steps DROP CONSTRAINT device_bootstrap_steps_canonical_authority_check;
ALTER TABLE device_bootstrap_steps ADD CONSTRAINT device_bootstrap_steps_canonical_authority_check CHECK (
  (canonical_request IS NULL AND step_kind IS NULL) OR
  (canonical_request IS NOT NULL AND octet_length(canonical_request) BETWEEN 1 AND 1048576 AND step_kind IS NOT NULL));
ALTER TABLE device_bootstrap_steps ADD CONSTRAINT device_bootstrap_steps_result_size CHECK (octet_length(canonical_result) BETWEEN 1 AND 1048576);
DO $body$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='device_bootstrap_authorities'::regclass
    AND contype='c' AND pg_get_constraintdef(oid) LIKE '%octet_length(verified_entity_digests)%' LOOP
    EXECUTE format('ALTER TABLE device_bootstrap_authorities DROP CONSTRAINT %I',c.conname);
  END LOOP;
END $body$;
ALTER TABLE device_bootstrap_authorities ADD CONSTRAINT device_bootstrap_authorities_verified_size CHECK (
  (verified_entity_digests IS NULL AND verified_rebuild_digest IS NULL) OR
  (verified_entity_digests IS NOT NULL AND octet_length(verified_entity_digests) BETWEEN 1 AND 1048576 AND verified_rebuild_digest IS NOT NULL));
ALTER TABLE device_bootstrap_capabilities
 ADD COLUMN claim_response bytea,
 ADD COLUMN claim_response_digest bytea,
 ADD COLUMN signer_receipt_digest bytea,
 ADD CONSTRAINT device_bootstrap_claim_receipt CHECK (
  (claim_response IS NULL AND claim_response_digest IS NULL AND signer_receipt_digest IS NULL) OR
  (claim_response IS NOT NULL AND octet_length(claim_response) BETWEEN 1 AND 16384
    AND claim_response_digest IS NOT NULL AND octet_length(claim_response_digest)=32
    AND signer_receipt_digest IS NOT NULL AND octet_length(signer_receipt_digest)=32 AND ready_at IS NOT NULL));
ALTER TABLE device_bootstrap_activation_attempts
 ADD COLUMN request_digest bytea,
 ADD COLUMN canonical_request bytea,
 ADD COLUMN canonical_response bytea,
 ADD CONSTRAINT device_bootstrap_activation_receipt CHECK (
  (request_digest IS NULL AND canonical_request IS NULL AND canonical_response IS NULL) OR
  (request_digest IS NOT NULL AND octet_length(request_digest)=32
    AND canonical_request IS NOT NULL AND octet_length(canonical_request) BETWEEN 1 AND 16384
    AND canonical_response IS NOT NULL AND octet_length(canonical_response) BETWEEN 1 AND 16384 AND status='installed'));
`,
};
