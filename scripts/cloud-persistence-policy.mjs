export function cloudPersistenceBoundaryErrors(localPath, source) {
  const errors = [];
  const isDbInfrastructure = localPath.startsWith("apps/cloud/src/db/");
  const isCatalog = localPath === "apps/cloud/src/db/migrations.ts";
  const ownsBusinessTable = /\b(?:workspace_revisions|workspace_workspaces|workspace_account_bindings|portfolio_domain_assets|portfolio_projection_state|workspace_replica_[a-z_]+|identity_accounts|identity_account_security_states|identity_auth_sessions|identity_refresh_families|identity_credential_jtis|workspace_mutation_receipts|workspace_mutations|workspace_mutation_fields|workspace_reader_cursors|workspace_checkpoints|workspace_checkpoint_entity_digests|workspace_checkpoint_domain_assets|workspace_checkpoint_pins|restore_candidate_requests|restore_candidates|tenant_jobs)\b/u.test(source);
  const isOwnedCapabilityMigration = /apps\/cloud\/src\/modules\/(?:identity|devices|execution-ledger|audit|recovery|job-runtime|workspace\/(?:revisions|mutations|cursors|checkpoints|default-workspace|state\/portfolio))\/migrations\//u.test(localPath);

  if (isDbInfrastructure && !isCatalog && ownsBusinessTable) {
    errors.push("db infrastructure cannot own or query workspace capability tables");
  }
  if (
    localPath === "apps/cloud/src/modules/workspace/read/index.ts"
    && /(?:postgres-repository|\/db(?:\/|["']))/u.test(source)
  ) {
    errors.push("workspace/read must consume only the public portfolio query port");
  }
  if (
    localPath.includes("/migrations/")
    && !isOwnedCapabilityMigration
    && ownsBusinessTable
  ) {
    errors.push("workspace business migrations must remain under their owning capability module");
  }
  if (
    localPath.endsWith("/workspace/state/portfolio/postgres-repository.ts")
    && /\bworkspace_revisions\b/u.test(source)
  ) {
    errors.push("portfolio repository must use the public revisions port instead of querying its table");
  }
  return errors;
}
