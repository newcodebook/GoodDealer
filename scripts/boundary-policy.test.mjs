import assert from "node:assert/strict";
import test from "node:test";

import {
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
