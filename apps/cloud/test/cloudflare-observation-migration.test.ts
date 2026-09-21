import { describe, expect, it } from "vitest";

import { cloudflareDnsObservationMigration } from "../src/modules/workspace/sync/migrations/202609150002-cloudflare-dns-observation";

describe("Cloudflare DNS observation migration", () => {
  it("creates forced tenant RLS, immutable receipts, composite tenant FKs, and narrow grants", () => {
    const sql = cloudflareDnsObservationMigration.sql;
    expect(sql).toContain("cloudflare_dns_observation_receipts");
    expect(sql).toContain("cloudflare_dns_observation_projections");
    expect(sql.match(/FORCE ROW LEVEL SECURITY/gu)).toHaveLength(3);
    expect(sql).toContain("FOREIGN KEY (account_id, workspace_id, entity_id)");
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON cloudflare_dns_observation_receipts");
    expect(sql).toContain("GRANT SELECT, INSERT ON cloudflare_dns_observation_receipts TO gd_account_api");
    expect(sql).toContain("ALTER TABLE cloudflare_dns_observation_receipts OWNER TO gooddealer_cloud_owner");
    expect(sql).toContain("role_row.rolsuper OR role_row.rolbypassrls");
    expect(sql).toContain("AS RESTRICTIVE TO gd_account_api");
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*cloudflare_dns_observation/isu);
    expect(sql).not.toContain("provider_account_id");
    expect(sql).not.toContain("zone_id");
    expect(sql).not.toContain("record_value");
  });
});
