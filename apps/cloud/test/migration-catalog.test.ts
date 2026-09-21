import { createHash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildMigrationCatalog } from "../src/db/index";
import { checkedCloudMigrationCatalog, cloudMigrations } from "../src/db/migrations";
import { serverAuditSubstrateMigration } from "../src/modules/audit/migrations/202608200013-server-audit-substrate";
import { accountDefaultWorkspaceMigration } from "../src/modules/workspace/default-workspace/migrations/202608200014-account-default-workspace";
import { commercialEntitlementsMigration } from "../src/modules/licensing/migrations/202608200015-commercial-entitlements";
import { desktopRefreshIdempotencyMigration } from "../src/modules/identity/migrations/202608200016-desktop-refresh-idempotency";
import { desktopLoginAuthorityMigration } from "../src/modules/devices/migrations/202608200017-desktop-login-authority";
import { identityTransactionCapabilityMigration } from "../src/modules/identity/migrations/202608200019-transaction-capability";
import { accountAccessMigration } from "../src/modules/identity/migrations/202609040001-account-access";
import { businessReplicaModelMigration } from "../src/modules/workspace/state/portfolio/migrations/202608200002-business-replica-model";
import { workspaceCheckpointV2Migration } from "../src/modules/workspace/checkpoints/migrations/202609150001-workspace-checkpoint-v2";
import { cloudflareDnsObservationMigration } from "../src/modules/workspace/sync/migrations/202609150002-cloudflare-dns-observation";

const expectedCatalog = [
  {
    id: "202608200001-workspace-revisions",
    owner: "workspace/revisions",
    checksum: "327a171011b63aefd6c05f77ea93679133e20cd6e27f1c33fce2979fe260a3d1",
  },
  {
    id: "202608200002-business-replica-model",
    owner: "workspace/state/portfolio",
    checksum: "161d171914c7e394e75fc42ab5f8c43ed1289c754be7bae11084170723c57271",
  },
  {
    id: "202608200003-identity-authentication",
    owner: "identity",
    checksum: "000d8a6a3b01d5c3fa8a1b3c8f38ca3242aba890164d32053364ec80c1cd42e8",
  },
  {
    id: "202608200004-device-control",
    owner: "devices",
    checksum: "a9fe5894b37074ab5d58cab69cbe223ec7cbcc1e01ccdd7c8b0bf4a39a4d6798",
  },
  {
    id: "202608200005-device-cursors",
    owner: "workspace/cursors",
    checksum: "670fed789acd66cd259c7371803a8df26cb10773e41e4a83d62f1e583ae5acfa",
  },
  {
    id: "202608200006-mutation-drain-ledger",
    owner: "workspace/mutations",
    checksum: "80ef0c09a465dd6fff148b56317c362c55844ae9367c8cbb5bf6f30ae119bfe3",
  },
  {
    id: "202608200007-execution-fact-drain-ledger",
    owner: "execution-ledger",
    checksum: "2547680b887a9cca48880ee58a19718f7fa280ac8652bf980a3d7aa29482deab",
  },
  {
    id: "202608200008-workspace-device-audit-drain-ledger",
    owner: "audit",
    checksum: "ffe127b998592e820f99add0cb6a91a2eeecf173b6a7b16b353da9d9f0ff355f",
  },
  {
    id: "202608200009-workspace-mutation-log",
    owner: "workspace/mutations",
    checksum: "c5bf2dedfaa1e5379e6673868db2280af2e0f961d3319118cb0b5bae0efa292f",
  },
  {
    id: "202608200010-workspace-checkpoints",
    owner: "workspace/checkpoints",
    checksum: "a0d4cb3a2cc18c79a7402244dd93ca346f9676afd312db9380439c9c52dbf104",
  },
  {
    id: "202608200011-restore-candidate-foundation",
    owner: "recovery",
    checksum: "d85078febf6f26165d6f33372b2c2a7787b3733fb57b034728d6b494021eab9c",
  },
  {
    id: "202608200012-job-runtime",
    owner: "job-runtime",
    checksum: "6262b57add24c6f2a9c4db689cef1b6de7335e0747e7d73d0f719fdb0a6c24db",
  },
  {
    id: "202608200013-server-audit-substrate",
    owner: "audit",
    checksum: "a4953760e75a3d18442316b70ed28bad87304d14ae27eeba1403b33864787b4c",
  },
  {
    id: "202608200014-account-default-workspace",
    owner: "workspace/default-workspace",
    checksum: "4d0c96c3a4710c7c2a208dcf7143be2f5589c0ee5f6613aa8e2d3d6451f0b204",
  },
  {
    id: "202608200015-commercial-entitlements",
    owner: "licensing",
    checksum: "026d23a0eeddad81b0624fc9fe9186546056e12ad752c477f5ee2a5307edf8a9",
  },
  {
    id: "202608200016-desktop-refresh-idempotency",
    owner: "identity",
    checksum: "66b78e669063f67d19cd5275192c4553a9a30748dd19241798ad390746e68bd8",
  },
  {
    id: "202608200017-desktop-login-authority",
    owner: "devices",
    checksum: "55547946e980ff9242833797bd1bd14725f6f6b37f7157fd95b320deb2051f3d",
  },
  {
    id: "202608200019-transaction-capability",
    owner: "identity",
    checksum: "e364ac4cc2ac5a944d5c2b12b75e17d46286641814ec5dbd12d9ee28f735107b",
  },
  {
    id: "202609040001-account-access",
    owner: "identity",
    checksum: "7d19d3c69da07802772567b97a903d6f80ea2dd6f3fde50627237035c3d63f47",
  },
  {
    id: "202609140001-sync-v2-ledger",
    owner: "workspace/mutations",
    checksum: "8f2b226b8b86f59042ebc05446339fd07cfd1d3863416ee4073e4766e6114e7e",
  },
  {
    id: "202609150001-workspace-checkpoint-v2",
    owner: "workspace/checkpoints",
    checksum: "72d4faff6b85571f5250278f6fae6405836b3c5ab55b5e4b58adfddb793f8151",
  },
  {
    id: "202609150002-cloudflare-dns-observation",
    owner: "workspace/sync",
    checksum: "36b2b252e011adbf01753de3ece59ea44dd630ae93a5be8e57cdbe1618418f38",
  },
] as const;

const expectedMigrationFiles = expectedCatalog.map(
  ({ id, owner }) => `src/modules/${owner}/migrations/${id}.ts`,
).sort();

describe("Cloud migration catalog", () => {
  it("keeps the frozen prefix and terminal account-access migration as literal imports rather than discovery", () => {
    const source = readFileSync(new URL("../src/db/migrations.ts", import.meta.url), "utf8")
      .replaceAll("\r\n", "\n");

    expect(source).toContain(
      'import { accountDefaultWorkspaceMigration } from "../modules/workspace/default-workspace/migrations/202608200014-account-default-workspace";',
    );
    expect(source).toContain(
      'import { businessReplicaModelMigration } from "../modules/workspace/state/portfolio/migrations/202608200002-business-replica-model";',
    );
    expect(source).toContain(
      'import { commercialEntitlementsMigration } from "../modules/licensing/migrations/202608200015-commercial-entitlements";',
    );
    expect(source).toContain(
      "  commercialEntitlementsMigration,\n  desktopRefreshIdempotencyMigration,\n"
      + "  desktopLoginAuthorityMigration,\n  identityTransactionCapabilityMigration,\n  accountAccessMigration,\n"
      + "  syncV2LedgerMigration,\n  workspaceCheckpointV2Migration,\n  cloudflareDnsObservationMigration,\n];",
    );
    expect(source).toContain('import { cloudflareDnsObservationMigration } from "../modules/workspace/sync/migrations/202609150002-cloudflare-dns-observation";');
    expect(source).not.toMatch(/(?:import\.meta\.glob|readdir|glob\(|import\(|sort\()/u);
  });

  it("preserves the literal ordered migration identity, ownership, and checksums", () => {
    const projection = checkedCloudMigrationCatalog.map(({ id, owner, checksum }) => ({ id, owner, checksum }));
    const expectedM019 = expectedCatalog[19];
    if (expectedM019 === undefined) throw new Error("M019 fixture is unexpectedly absent");

    expect(projection).toEqual(expectedCatalog);
    expect(checkedCloudMigrationCatalog).toHaveLength(22);
    expect(new Set(projection.map(({ id }) => id)).size).toBe(expectedCatalog.length);
    for (const [index, migration] of projection.entries()) {
      if (index > 0) expect(migration.id > projection[index - 1]!.id).toBe(true);
    }
    expect(projection.filter(({ id }) => id === expectedM019.id)).toEqual([expectedM019]);
    expect(projection[12]?.id).toBe("202608200013-server-audit-substrate");
    expect(projection[19]).toEqual(expectedM019);
    expect(projection[20]).toEqual(expectedCatalog[20]);
  });

  it("keeps exactly one owned migration file for each catalog entry", () => {
    const migrationFiles = globSync("src/modules/**/migrations/*.ts", {
      cwd: new URL("../", import.meta.url),
    }).map((file) => file.replaceAll("\\", "/")).sort();

    expect(migrationFiles).toEqual(expectedMigrationFiles);
  });

  it("defines every table once and permits only same-owner forward column evolution", () => {
    const tableDefinitions = new Map<string, { readonly id: string; readonly owner: string }>();
    for (const migration of cloudMigrations) {
      for (const match of migration.sql.matchAll(
        /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gu,
      )) {
        const table = match[1]!;
        expect(tableDefinitions.has(table), `${table} is defined by more than one migration`).toBe(false);
        tableDefinitions.set(table, { id: migration.id, owner: migration.owner });
      }
    }

    for (const migration of cloudMigrations) {
      for (const match of migration.sql.matchAll(
        /ALTER TABLE\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s+ADD COLUMN/gu,
      )) {
        const table = match[1]!;
        const definition = tableDefinitions.get(table);
        expect(definition, `${table} is altered before it is defined`).toBeDefined();
        expect(migration.id >= definition!.id, `${table} is altered before its defining migration`).toBe(true);
        expect(migration.owner, `${table} crosses migration ownership`).toBe(definition!.owner);
      }
    }
  });

  it("matches literal checksum fixtures to the normalized M002/M013–M015 and forward M016–M017/M019 sources", () => {
    const finalSources = [
      businessReplicaModelMigration,
      serverAuditSubstrateMigration,
      accountDefaultWorkspaceMigration,
      commercialEntitlementsMigration,
      desktopRefreshIdempotencyMigration,
      desktopLoginAuthorityMigration,
      identityTransactionCapabilityMigration,
      accountAccessMigration,
    ];
    const indexes = [1, 12, 13, 14, 15, 16, 17, 18];
    for (const [offset, migration] of finalSources.entries()) {
      expect(createHash("sha256").update(migration.sql, "utf8").digest("hex"))
        .toBe(expectedCatalog[indexes[offset]!]?.checksum);
    }
  });

  it("keeps the durable M003 and M004 prefix byte-identical while evolving through M016 and M017", () => {
    expect(expectedCatalog[2]?.checksum)
      .toBe("000d8a6a3b01d5c3fa8a1b3c8f38ca3242aba890164d32053364ec80c1cd42e8");
    expect(expectedCatalog[3]?.checksum)
      .toBe("a9fe5894b37074ab5d58cab69cbe223ec7cbcc1e01ccdd7c8b0bf4a39a4d6798");
    expect(desktopRefreshIdempotencyMigration.sql).toContain("CREATE TABLE identity_desktop_authorization_codes");
    expect(desktopLoginAuthorityMigration.sql).toContain("CREATE TABLE device_login_challenges");
    expect(desktopLoginAuthorityMigration.sql).toContain("release_reason = 'lease_verifier_upgrade'");
    expect(desktopLoginAuthorityMigration.sql).toContain("device_active_leases_held_verified_wire");
  });

  it("uses M015 as the normalized greenfield commercial baseline without compatibility migration", () => {
    expect(commercialEntitlementsMigration.sql).toContain("commercial_provider_slots");
    expect(commercialEntitlementsMigration.sql).toContain("commercial_authorities");
    expect(commercialEntitlementsMigration.sql).not.toContain("licensing_commercial_purchases");
  });

  it("rebuilds the checked global catalog from the ordered migration inventory", () => {
    expect(buildMigrationCatalog(cloudMigrations)).toEqual(checkedCloudMigrationCatalog);
  });

  it("keeps the checkpoint wire-version change append-only", () => {
    expect(workspaceCheckpointV2Migration.sql).toContain("DROP CONSTRAINT workspace_checkpoints_schema_version_check");
    expect(workspaceCheckpointV2Migration.sql).toContain("CHECK (schema_version IN (1, 2))");
  });

  it("matches the Cloudflare observation migration checksum", () => {
    expect(createHash("sha256").update(cloudflareDnsObservationMigration.sql, "utf8").digest("hex"))
      .toBe(expectedCatalog[21]?.checksum);
  });

  it("rejects duplicates, order drift, invalid ids, and empty SQL before database access", () => {
    const migration = { id: "202608200001-first", owner: "module/a", sql: "SELECT 1" };
    expect(() => buildMigrationCatalog([migration, migration])).toThrow("duplicate migration id");
    expect(() => buildMigrationCatalog([
      { ...migration, id: "202608200002-second" },
      migration,
    ])).toThrow("not globally increasing");
    expect(() => buildMigrationCatalog([{ ...migration, id: "not-ordered" }])).toThrow("invalid migration id");
    expect(() => buildMigrationCatalog([{ ...migration, sql: " " }])).toThrow("incomplete");
  });
});
