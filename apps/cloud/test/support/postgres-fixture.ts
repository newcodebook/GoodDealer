import type { Pool } from "pg";

/** Clear Licensing-owned rows before fixtures remove Identity accounts referenced by that domain. */
export async function clearLicensingTestData(ownerPool: Pool): Promise<void> {
  const client = await ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE gd_licensing_owner");
    const tables = await client.query<{ relation: string }>(`
      SELECT pg_catalog.format('%I.%I', schemaname, tablename) AS relation
      FROM pg_catalog.pg_tables
      WHERE schemaname = 'licensing_private'
      ORDER BY tablename`);
    if (tables.rows.length === 0) throw new Error("Licensing test schema has no owned tables");
    await client.query(`TRUNCATE ${tables.rows.map(({ relation }) => relation).join(", ")}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
