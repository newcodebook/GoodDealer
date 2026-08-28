import { createHash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildMigrationCatalog } from "../src/db/index";
import { checkedCloudMigrationCatalog, cloudMigrations } from "../src/db/migrations";
import { serverAuditSubstrateMigration } from "../src/modules/audit/migrations/202608200013-server-audit-substrate";
import { accountDefaultWorkspaceMigration } from "../src/modules/workspace/default-workspace/migrations/202608200014-account-default-workspace";
import { businessReplicaModelMigration } from "../src/modules/workspace/state/portfolio/migrations/202608200002-business-replica-model";

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
] as const;

const expectedMigrationFiles = expectedCatalog.map(
  ({ id, owner }) => `src/modules/${owner}/migrations/${id}.ts`,
).sort();

describe("Cloud migration catalog", () => {
  it("keeps the consolidated M002 and terminal M014 as literal imports rather than discovered migrations", () => {
    const source = readFileSync(new URL("../src/db/migrations.ts", import.meta.url), "utf8");

    expect(source).toContain(
      'import { accountDefaultWorkspaceMigration } from "../modules/workspace/default-workspace/migrations/202608200014-account-default-workspace";',
    );
    expect(source).toContain(
      'import { businessReplicaModelMigration } from "../modules/workspace/state/portfolio/migrations/202608200002-business-replica-model";',
    );
    expect(source).toContain(
      "  serverAuditSubstrateMigration,\n  accountDefaultWorkspaceMigration,\n];",
    );
    expect(source).not.toMatch(/(?:import\.meta\.glob|readdir|glob\(|import\(|sort\()/u);
  });

  it("preserves the literal ordered M001–M014 final snapshot identity, ownership, and checksums", () => {
    const projection = checkedCloudMigrationCatalog.map(({ id, owner, checksum }) => ({ id, owner, checksum }));
    const expectedM014 = expectedCatalog[expectedCatalog.length - 1];
    if (expectedM014 === undefined) throw new Error("M014 fixture is unexpectedly absent");

    expect(projection).toEqual(expectedCatalog);
    expect(checkedCloudMigrationCatalog).toHaveLength(14);
    expect(new Set(projection.map(({ id }) => id)).size).toBe(expectedCatalog.length);
    for (const [index, migration] of projection.entries()) {
      if (index > 0) expect(migration.id > projection[index - 1]!.id).toBe(true);
    }
    expect(projection.filter(({ id }) => id === expectedM014.id)).toEqual([expectedM014]);
    expect(projection[12]?.id).toBe("202608200013-server-audit-substrate");
    expect(projection[13]).toEqual(expectedM014);
  });

  it("keeps exactly one consolidated design-time migration file for each M001–M014 catalog entry", () => {
    const migrationFiles = globSync("src/modules/**/migrations/*.ts", {
      cwd: new URL("../", import.meta.url),
    }).sort();

    expect(migrationFiles).toEqual(expectedMigrationFiles);
  });

  it("defines every table once and keeps design-time column additions in that table's owning migration", () => {
    const tableDefinitions = new Map<string, string>();
    for (const migration of cloudMigrations) {
      for (const match of migration.sql.matchAll(
        /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?([a-z_][a-z0-9_]*)/gu,
      )) {
        const table = match[1]!;
        expect(tableDefinitions.has(table), `${table} is defined by more than one migration`).toBe(false);
        tableDefinitions.set(table, migration.id);
      }
    }

    for (const migration of cloudMigrations) {
      for (const match of migration.sql.matchAll(
        /ALTER TABLE\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+ADD COLUMN/gu,
      )) {
        const table = match[1]!;
        expect(tableDefinitions.get(table), `${table} column shape is split across migrations`)
          .toBe(migration.id);
      }
    }
  });

  it("matches literal checksum fixtures to the exact consolidated M002 and final M013–M014 SQL sources", () => {
    const finalSources = [
      businessReplicaModelMigration,
      serverAuditSubstrateMigration,
      accountDefaultWorkspaceMigration,
    ];
    const indexes = [1, 12, 13];
    for (const [offset, migration] of finalSources.entries()) {
      expect(createHash("sha256").update(migration.sql, "utf8").digest("hex"))
        .toBe(expectedCatalog[indexes[offset]!]?.checksum);
    }
  });

  it("rebuilds the checked global catalog from the ordered migration inventory", () => {
    expect(buildMigrationCatalog(cloudMigrations)).toEqual(checkedCloudMigrationCatalog);
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
