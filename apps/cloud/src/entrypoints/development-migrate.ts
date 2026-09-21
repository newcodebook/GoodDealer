import { createCloudDatabasePool, runCloudMigrations } from "../db/index";
import { cloudMigrations } from "../db/migrations";

const ownerUrl = requiredEnvironment("GOODDEALER_POSTGRES_OWNER_URL");
const pool = createCloudDatabasePool({ connectionString: ownerUrl, max: 1 });

try {
  const applied = await runCloudMigrations(pool, cloudMigrations);
  process.stdout.write(`GoodDealer Cloud migrations verified (${applied.length})\n`);
} finally {
  await pool.end();
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new TypeError(`${name} is required`);
  return value;
}
