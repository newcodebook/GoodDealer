import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cloudPersistenceBoundaryErrors } from "./cloud-persistence-policy.mjs";

test("db infrastructure cannot absorb capability tables", () => {
  assert.deepEqual(
    cloudPersistenceBoundaryErrors("apps/cloud/src/db/index.ts", "SELECT * FROM workspace_revisions"),
    ["db infrastructure cannot own or query workspace capability tables"],
  );
});

test("capability-owned migrations stay accepted while misplaced business SQL is rejected", () => {
  for (const path of [
    "apps/cloud/src/modules/workspace/mutations/migrations/202608200009-workspace-mutation-log.ts",
    "apps/cloud/src/modules/workspace/cursors/migrations/202608200005-device-cursors.ts",
    "apps/cloud/src/modules/workspace/checkpoints/migrations/202608200010-workspace-checkpoints.ts",
    "apps/cloud/src/modules/recovery/migrations/202608200011-restore-candidate-foundation.ts",
    "apps/cloud/src/modules/job-runtime/migrations/202608200012-job-runtime.ts",
    "apps/cloud/src/modules/workspace/default-workspace/migrations/202608200014-account-default-workspace.ts",
    "apps/cloud/src/modules/workspace/state/portfolio/migrations/202608200002-business-replica-model.ts",
  ]) {
    assert.deepEqual(cloudPersistenceBoundaryErrors(path, "REFERENCES workspace_revisions"), [], path);
  }
  assert.deepEqual(
    cloudPersistenceBoundaryErrors(
      "apps/cloud/src/modules/workspace/read/migrations/misplaced.ts",
      "CREATE TABLE workspace_replica_domain_assets (id text)",
    ),
    ["workspace business migrations must remain under their owning capability module"],
  );
});

test("workspace read cannot deep-import PostgreSQL or db implementation", () => {
  assert.deepEqual(
    cloudPersistenceBoundaryErrors(
      "apps/cloud/src/modules/workspace/read/index.ts",
      'import { adapter } from "../state/portfolio/postgres-repository";',
    ),
    ["workspace/read must consume only the public portfolio query port"],
  );
  const source = readFileSync(
    new URL("../apps/cloud/src/modules/workspace/read/index.ts", import.meta.url),
    "utf8",
  );
  assert.deepEqual(cloudPersistenceBoundaryErrors("apps/cloud/src/modules/workspace/read/index.ts", source), []);
  assert.match(source, /import type \{ PortfolioProjectionQueryPort \} from "\.\.\/state\/portfolio\/index"/u);
});

test("Cloud persistence evidence is explicit and cannot silently skip PostgreSQL", () => {
  const manifest = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../.github/workflows/wp4-cloud-persistence.yml", import.meta.url), "utf8");
  const integration = readFileSync(
    new URL("../apps/cloud/test/postgres/persistence.test.ts", import.meta.url),
    "utf8",
  );
  assert.match(manifest, /"evidence:wp4:persistence"/u);
  assert.match(workflow, /postgres:18\.6/u);
  assert.match(workflow, /GOODDEALER_POSTGRES_APP_URL/u);
  assert.match(integration, /PostgreSQL integration evidence never skips/u);
  assert.match(integration, /\^18\\\.6/u);
});

test("portfolio repository cannot query the revisions-owned table", () => {
  assert.deepEqual(
    cloudPersistenceBoundaryErrors(
      "apps/cloud/src/modules/workspace/state/portfolio/postgres-repository.ts",
      "SELECT server_revision FROM workspace_revisions",
    ),
    ["portfolio repository must use the public revisions port instead of querying its table"],
  );
});
