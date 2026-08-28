import assert from "node:assert/strict";
import test from "node:test";

import {
  cloudEntrypointSourceErrors,
  importBoundaryErrors,
} from "./boundary-policy.mjs";

test("leaves workspace direction to the repository topology policy", () => {
  assert.deepEqual(
    importBoundaryErrors("apps/desktop/src/app.tsx", "@gooddealer/connector-cloudflare"),
    [],
  );
  assert.deepEqual(
    importBoundaryErrors("apps/admin-web/src/index.ts", "@gooddealer/protocol/admin"),
    [],
  );
});

test("keeps Host APIs out of client-core", () => {
  assert.notDeepEqual(
    importBoundaryErrors("packages/client-core/src/index.ts", "@tauri-apps/api"),
    [],
  );
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
