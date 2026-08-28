import { describe, expect, it } from "vitest";

import { buildMigrationCatalog } from "../src/db/index";
import { businessReplicaModelMigration } from "../src/modules/workspace/state/portfolio/migrations/202608200002-business-replica-model";

describe("business replica model M002", () => {
  it("makes replica ownership explicit and excludes local Provider identity surfaces", () => {
    expect(buildMigrationCatalog([businessReplicaModelMigration])[0]).toMatchObject({
      id: "202608200002-business-replica-model",
      owner: "workspace/state/portfolio",
    });
    const sql = businessReplicaModelMigration.sql;
    expect(sql).toContain("CREATE TABLE workspace_replica_domain_assets");
    expect(sql).toContain("CREATE TABLE workspace_replica_portfolio_state");
    expect(sql).not.toMatch(/CREATE TABLE portfolio_domain_assets|ALTER TABLE portfolio_domain_assets|portfolio_projection_state/u);
    expect(sql).toContain("workspace_replica_tombstones");
    expect(sql).toContain("workspace_replica_business_events");
    expect(sql).not.toMatch(/connection_id|provider_account_id|account_label|sealed_credential|api_key|refresh_token|cookie|password|browser_profile/iu);
  });

  it("uses dual-key forced RLS on every added replica table", () => {
    const sql = businessReplicaModelMigration.sql;
    const addedTables = [
      "workspace_replica_domain_assets",
      "workspace_replica_portfolio_state",
      "workspace_replica_portfolios",
      "workspace_replica_observations",
      "workspace_replica_dns_records",
      "workspace_replica_operation_summaries",
      "workspace_replica_business_events",
      "workspace_replica_tombstones",
    ];
    for (const table of addedTables) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY ${table}_tenant_scope ON ${table}`);
    }
    expect(sql.match(/account_id = current_setting\('gooddealer\.account_id', true\)/gu)).toHaveLength(16);
    expect(sql.match(/workspace_id = current_setting\('gooddealer\.workspace_id', true\)/gu)).toHaveLength(16);
  });

  it("models lifecycle, observations, operations, history, deletion, and scale indexes", () => {
    const sql = businessReplicaModelMigration.sql;
    for (const required of [
      "lifecycle_status",
      "desired_sale_status",
      "observed_at",
      "observation_availability",
      "evidence_status",
      "unknown_count",
      "observation_payload",
      "deleted_server_revision",
      "workspace_replica_domain_assets_status_expiry",
      "workspace_replica_business_events_aggregate",
    ]) expect(sql).toContain(required);
    expect(sql).toContain("octet_length(observation_payload::text) <= 1048576");
    expect(sql).toContain("payload_schema_version integer NOT NULL");
    expect(sql).toContain("payload_sha256 bytea NOT NULL");
    expect(sql).toContain("GRANT INSERT (account_id, workspace_id, entity_id, note, portfolio_id, tags,");
    expect(sql).toContain("GRANT UPDATE (note, portfolio_id, tags, target_price_currency, target_price_amount,");
    expect(sql).not.toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON");
    expect(sql).toContain("GRANT SELECT ON\n      workspace_replica_portfolios");
  });

  it("backfills honest projection state and installs the future-workspace initializer atomically", () => {
    const sql = businessReplicaModelMigration.sql;
    const noForce = sql.indexOf("ALTER TABLE workspace_revisions NO FORCE ROW LEVEL SECURITY");
    const backfill = sql.indexOf("INSERT INTO workspace_replica_portfolio_state", noForce);
    const force = sql.indexOf("ALTER TABLE workspace_revisions FORCE ROW LEVEL SECURITY", backfill);
    expect(noForce).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(noForce);
    expect(force).toBeGreaterThan(backfill);
    expect(sql).toContain("CREATE TRIGGER workspace_replica_portfolio_state_initialize");
    expect(sql).toContain("INSERT INTO public.workspace_replica_portfolio_state");
  });
});
