import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const requiredPaths = [
  "apps/desktop/src/composition-root.ts",
  "apps/desktop/src/adapters/tauri",
  "apps/desktop/src-tauri",
  "apps/account-web/src",
  "apps/admin-web/src/features",
  "apps/admin-web/src/api",
  "apps/cloud/src/entrypoints/http.ts",
  "apps/cloud/src/entrypoints/admin-http.ts",
  "apps/cloud/src/entrypoints/jobs.ts",
  "packages/protocol/src/admin",
  "packages/client-core/src/runtime-mode",
  "packages/cloud-client/src",
  "packages/connector-sdk/src",
  "packages/connector-test-kit/src",
  "packages/connectors/spaceship/src",
  "packages/connectors/cloudflare/src",
  "packages/connectors/atom/src",
  "packages/connectors/afternic/src",
  "packages/browser-automation/src/contracts",
  "crates/secure-host-core/src",
  "crates/local-storage/src",
  "crates/automation-host/src",
];

const errors = requiredPaths
  .filter((path) => !existsSync(resolve(root, path)))
  .map((path) => `missing required workspace path: ${path}`);

if (existsSync(resolve(root, "apps/mobile"))) {
  errors.push("apps/mobile must not exist before Phase 6");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`workspace structure check passed (${requiredPaths.length} required paths)`);
