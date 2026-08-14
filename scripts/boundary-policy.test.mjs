import assert from "node:assert/strict";
import test from "node:test";

import {
  cloudEntrypointSourceErrors,
  cloudManifestErrors,
  importBoundaryErrors,
  secureHostManifestErrors,
} from "./boundary-policy.mjs";

test("allows concrete connectors only in the desktop composition root", () => {
  assert.deepEqual(
    importBoundaryErrors("apps/desktop/src/composition-root.ts", "@gooddealer/connector-cloudflare"),
    [],
  );
  assert.notDeepEqual(
    importBoundaryErrors("apps/desktop/src/features/portfolio.ts", "@gooddealer/connector-cloudflare"),
    [],
  );
  assert.notDeepEqual(
    importBoundaryErrors("packages/connectors/atom/src/index.ts", "@gooddealer/connector-cloudflare"),
    [],
  );
});

test("rejects protocol/admin outside its trust domain", () => {
  assert.notDeepEqual(
    importBoundaryErrors("apps/desktop/src/app.tsx", "@gooddealer/protocol/admin"),
    [],
  );
  assert.deepEqual(
    importBoundaryErrors("apps/admin-web/src/index.ts", "@gooddealer/protocol/admin"),
    [],
  );
});

test("rejects Cloud, account-web, admin-web, and client-core forbidden edges", () => {
  assert.notDeepEqual(
    importBoundaryErrors("apps/cloud/src/index.ts", "@gooddealer/client-core"),
    [],
  );
  assert.notDeepEqual(
    importBoundaryErrors("apps/account-web/src/index.ts", "@gooddealer/client-core"),
    [],
  );
  assert.notDeepEqual(
    importBoundaryErrors("apps/admin-web/src/index.ts", "@gooddealer/cloud-client"),
    [],
  );
  assert.notDeepEqual(
    importBoundaryErrors("apps/admin-web/src/leak.ts", "@gooddealer/protocol/workspace"),
    [],
  );
  assert.deepEqual(
    importBoundaryErrors("apps/admin-web/src/index.ts", "@gooddealer/protocol/admin"),
    [],
  );
  assert.notDeepEqual(
    importBoundaryErrors("packages/client-core/src/index.ts", "@tauri-apps/api"),
    [],
  );
});

test("rejects forbidden package and Rust manifest dependencies", () => {
  assert.notDeepEqual(cloudManifestErrors('{"dependencies":{"@gooddealer/connector-atom":"1"}}'), []);
  assert.notDeepEqual(secureHostManifestErrors('[dependencies]\ntauri = "2"'), []);
  assert.deepEqual(secureHostManifestErrors('[dependencies]\nserde = "1"'), []);
});

test("keeps Public and Admin composition-root imports disjoint", () => {
  assert.deepEqual(
    importBoundaryErrors("apps/cloud/src/entrypoints/http.ts", "./ports/public-session"),
    [],
  );
  assert.notDeepEqual(
    importBoundaryErrors("apps/cloud/src/entrypoints/http.ts", "./ports/staff-session"),
    [],
  );
  assert.deepEqual(
    importBoundaryErrors("apps/cloud/src/entrypoints/admin-http.ts", "./ports/staff-session"),
    [],
  );
  assert.notDeepEqual(
    importBoundaryErrors("apps/cloud/src/entrypoints/admin-http.ts", "./routes/public/boundary"),
    [],
  );
});

test("keeps Cloud adapters mechanism-only", () => {
  assert.deepEqual(
    importBoundaryErrors("apps/cloud/src/entrypoints/adapter/schema.ts", "@gooddealer/protocol/wire"),
    [],
  );
  assert.notDeepEqual(
    importBoundaryErrors("apps/cloud/src/entrypoints/adapter/schema.ts", "../ports/public-session"),
    [],
  );
  assert.deepEqual(
    cloudEntrypointSourceErrors(
      "apps/cloud/src/entrypoints/adapter/rate-limit.ts",
      "export const NO_IDENTITY_HEADERS: readonly [] = [];",
    ),
    [],
  );
  assert.notDeepEqual(
    cloudEntrypointSourceErrors(
      "apps/cloud/src/entrypoints/adapter/rate-limit.ts",
      'export const COOKIE = "gd_session";',
    ),
    [],
  );
});

test("allows Cloud routes only through declared contracts and ports", () => {
  assert.deepEqual(
    importBoundaryErrors(
      "apps/cloud/src/entrypoints/routes/public/boundary.ts",
      "@gooddealer/protocol/wire",
    ),
    [],
  );
  assert.deepEqual(
    importBoundaryErrors(
      "apps/cloud/src/entrypoints/routes/public/boundary.ts",
      "../../ports/public-session",
    ),
    [],
  );
  assert.deepEqual(
    importBoundaryErrors(
      "apps/cloud/src/entrypoints/routes/public/account.ts",
      "../../../modules/identity/index",
    ),
    [],
  );
  assert.notDeepEqual(
    importBoundaryErrors(
      "apps/cloud/src/entrypoints/routes/public/account.ts",
      "../../../modules/identity/private-repository",
    ),
    [],
  );
  assert.notDeepEqual(
    importBoundaryErrors("apps/cloud/src/entrypoints/routes/admin/boundary.ts", "node:fs"),
    [],
  );
});

test("keeps HTTP and network primitives out of Cloud business modules", () => {
  assert.deepEqual(
    cloudEntrypointSourceErrors(
      "apps/cloud/src/modules/licensing/index.ts",
      "export const licensingModule = 'boundary-only';",
    ),
    [],
  );
  assert.notDeepEqual(
    cloudEntrypointSourceErrors(
      "apps/cloud/src/modules/licensing/index.ts",
      'import Fastify from "fastify";',
    ),
    [],
  );
  assert.notDeepEqual(
    cloudEntrypointSourceErrors(
      "apps/cloud/src/modules/licensing/index.ts",
      'app.get("/v1/licenses", handler);',
    ),
    [],
  );
});
