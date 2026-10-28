import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const entrypoint = (name: string) => new URL(`../../src/entrypoints/${name}`, import.meta.url);

describe("development Cloud process credential boundaries", () => {
  it("keeps schema-owner credentials and migrations out of the long-running server", async () => {
    const server = await readFile(entrypoint("development-server.ts"), "utf8");
    expect(server).not.toContain("GOODDEALER_POSTGRES_OWNER_URL");
    expect(server).not.toContain("runCloudMigrations");
    expect(server).toContain("GOODDEALER_POSTGRES_APP_URL");
    expect(server).toContain("GOODDEALER_POSTGRES_ACCOUNT_API_URL");
    expect(server).toContain("GOODDEALER_POSTGRES_IDENTITY_ISSUER_URL");
    expect(server).toContain("GOODDEALER_POSTGRES_PROVIDER_INGRESS_URL");
    expect(server).toContain("GOODDEALER_POSTGRES_PROVIDER_WORKER_URL");
    expect(server).toContain("createCloudCapabilityDatabasePools");
  });

  it("gives the finite migration entrypoint only the schema-owner credential", async () => {
    const migrator = await readFile(entrypoint("development-migrate.ts"), "utf8");
    expect(migrator).toContain("GOODDEALER_POSTGRES_OWNER_URL");
    expect(migrator).toContain("runCloudMigrations");
    expect(migrator).not.toContain("GOODDEALER_POSTGRES_APP_URL");
  });

  it("composes public billing with credential-derived Identity and provider-worker pools only", async () => {
    const http = await readFile(entrypoint("http.ts"), "utf8");
    expect(http).toContain("new IdentityCapabilityTransactionRunner(accountApiPool, identityCapabilityIssuerPool)");
    expect(http).toContain("new ProviderDispatchExecutor(");
    expect(http).toContain("providerWorkerPool");
    expect(http).toContain("new CommercialCheckoutApplicationService(\n      identityTransactions,");
    expect(http).not.toContain("new CommercialCheckoutApplicationService(\n      accountTransactions,");
  });

  it("composes Desktop entitlement reads through the Identity capability runner", async () => {
    const oauth = await readFile(entrypoint("desktop-oauth-http.ts"), "utf8");
    expect(oauth).toContain(
      "new IdentityCapabilityTransactionRunner(\n    deps.accountApiPool,\n    deps.identityCapabilityIssuerPool,\n  )",
    );
    expect(oauth).toContain("new PostgresEntitlementDeadlineReader(authenticatedTransactions)");
    expect(oauth).not.toContain("new PostgresEntitlementDeadlineReader()");
  });
});
