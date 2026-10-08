import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { tauriCommandPolicyErrors } from "./tauri-command-policy.mjs";

function writeFile(root, path, source) {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, source);
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "gooddealer-tauri-command-"));
  const commands = [
    "cloudflare_connection_activate",
    "cloudflare_connection_status",
    "cloudflare_observation_read",
    "cloudflare_zone_observe",
    "desktop_authentication_begin",
    "desktop_authentication_refresh",
    "desktop_authentication_status",
    "local_business_status",
    "local_backup_artifact_select",
    "local_backup_export",
    "local_backup_restore_begin",
    "local_backup_restore_status",
    "local_conflict_center_read",
    "local_conflict_resolve",
    "local_sync_status",
    "local_domain_asset_edit",
    "local_domain_asset_delete",
    "local_domain_asset_provider_bind",
    "local_asset_library_read",
    "local_domain_detail_read",
  ];
  writeFile(root, "apps/desktop/src-tauri/build.rs", `AppManifest::new().commands(&[${commands.map((command) => `"${command}"`).join(",")}])\n`);
  writeFile(root, "apps/desktop/src-tauri/src/main.rs", `
let local_host = Arc::new(DesktopLocalHost::production(application_root)?);
app.manage(Arc::clone(&local_host));
tauri::generate_handler![${commands.join(",")}]
`);
  const ordinaryCommands = commands.filter((command) => !command.startsWith("local_backup_"));
  writeFile(root, "apps/desktop/src-tauri/src/handler.rs", `${ordinaryCommands.map((command) => `#[tauri::command]\nfn ${command}() {}`).join("\n")}
#[tauri::command]
async fn local_backup_restore_status(host: State<'_, Arc<DesktopLocalHost>>) -> Result<Status, String> {
  let aggregate = Arc::clone(host.inner());
  tauri::async_runtime::spawn_blocking(move || aggregate.backup_status())
    .await
    .map_err(|_| "BACKUP_STORAGE_REJECTED".to_owned())
}
#[tauri::command]
async fn local_backup_export(request: tauri::ipc::Request<'_>, host: State<'_, Arc<DesktopLocalHost>>) -> Result<Status, String> {
  let wire = bounded_request_wire(&request)?;
  let aggregate = Arc::clone(host.inner());
  tauri::async_runtime::spawn_blocking(move || aggregate.export_backup(&wire))
    .await
    .map_err(|_| "BACKUP_STORAGE_REJECTED".to_owned())?
    .map_err(map_desktop_backup_error)
}
#[tauri::command]
async fn local_backup_artifact_select(request: tauri::ipc::Request<'_>, host: State<'_, Arc<DesktopLocalHost>>) -> Result<Status, String> {
  let wire = bounded_request_wire(&request)?;
  let aggregate = Arc::clone(host.inner());
  tauri::async_runtime::spawn_blocking(move || aggregate.inspect_backup(&wire))
    .await
    .map_err(|_| "BACKUP_STORAGE_REJECTED".to_owned())?
    .map_err(map_desktop_backup_error)
}
#[tauri::command]
async fn local_backup_restore_begin(request: tauri::ipc::Request<'_>, host: State<'_, Arc<DesktopLocalHost>>) -> Result<Status, String> {
  let wire = bounded_request_wire(&request)?;
  let aggregate = Arc::clone(host.inner());
  tauri::async_runtime::spawn_blocking(move || aggregate.restore_backup(&wire))
    .await
    .map_err(|_| "BACKUP_STORAGE_REJECTED".to_owned())?
    .map_err(map_desktop_backup_error)
}
fn map_desktop_backup_error(error: DesktopBackupError) -> String { error.code().to_owned() }
`);
  writeFile(root, "apps/desktop/src-tauri/src/backup_ipc.rs", `
use tauri::ipc::{InvokeBody, Request};
const MAX_BACKUP_REQUEST_WIRE_BYTES: usize = 4_096;
fn bounded_request_wire(request: &Request<'_>) -> Result<Vec<u8>, String> {
  bounded_raw_body(request.body())
}
fn bounded_raw_body(body: &InvokeBody) -> Result<Vec<u8>, String> {
  let InvokeBody::Raw(wire) = body else { return Err(backup_operation_rejected()); };
  if !(1..=MAX_BACKUP_REQUEST_WIRE_BYTES).contains(&wire.len()) { return Err(backup_operation_rejected()); }
  Ok(wire.clone())
}
fn backup_operation_rejected() -> String { "BACKUP_OPERATION_REJECTED".to_owned() }
`);
  writeFile(root, "apps/desktop/src-tauri/Cargo.toml", "[dependencies]\ngooddealer-local-storage = { path = \"../../../crates/local-storage\" }\n");
  writeFile(
    root,
    "apps/desktop/src/adapters/tauri/index.ts",
    commands.filter((command) => !command.startsWith("local_backup_"))
      .map((command) => `"${command}"`)
      .join("\n"),
  );
  writeFile(
    root,
    "apps/desktop/src-tauri/capabilities/local-app.json",
    `${JSON.stringify({
      $schema: "../gen/schemas/desktop-schema.json",
      identifier: "local-app",
      description: "Local application shell with narrow business and authentication commands.",
      webviews: ["local-app"],
      permissions: ["core:default", ...commands.map((command) => `allow-${command.replaceAll("_", "-")}`)],
    })}\n`,
  );
  for (const command of commands) {
    writeFile(root, `apps/desktop/src-tauri/permissions/autogenerated/${command}.toml`, `identifier = "allow-${command.replaceAll("_", "-")}"\n`);
  }
  return root;
}

function useFixture(t) {
  const root = createFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("the repository Desktop bridge exposes exactly the reviewed business and authentication commands", () => {
  assert.deepEqual(tauriCommandPolicyErrors(), []);
});

test("rejects an unreviewed command or a missing reviewed command in each Desktop surface", (t) => {
  const mutations = [
    ["apps/desktop/src-tauri/build.rs", 'AppManifest::new().commands(&["unreviewed_command"])'],
    ["apps/desktop/src-tauri/src/main.rs", "tauri::generate_handler![unreviewed_command]"],
    ["apps/desktop/src-tauri/src/handler.rs", "#[tauri::command]\nfn unreviewed_command() {}"],
  ];
  for (const [path, source] of mutations) {
    const root = useFixture(t);
    writeFileSync(join(root, path), source);
    assert.ok(tauriCommandPolicyErrors({ root }).some((error) => error.includes("differs from reviewed")), path);
  }

  const capabilityRoot = useFixture(t);
  writeFile(
    capabilityRoot,
    "apps/desktop/src-tauri/capabilities/local-app.json",
    `${JSON.stringify({
      $schema: "../gen/schemas/desktop-schema.json",
      identifier: "local-app",
      description: "Local application shell with narrow business and authentication commands.",
      webviews: ["local-app"],
      permissions: ["allow-unreviewed-command"],
    })}\n`,
  );
  assert.ok(tauriCommandPolicyErrors({ root: capabilityRoot }).some((error) => error.includes("capability command set")));
});

test("rejects missing, symbolic-link, and adapter structural inputs", (t) => {
  const missingRoot = useFixture(t);
  rmSync(join(missingRoot, "apps/desktop/src-tauri/src/main.rs"));
  assert.ok(tauriCommandPolicyErrors({ root: missingRoot }).some((error) => error.includes("regular file")));

  const symlinkRoot = useFixture(t);
  rmSync(join(symlinkRoot, "apps/desktop/src-tauri/build.rs"));
  symlinkSync("missing-build", join(symlinkRoot, "apps/desktop/src-tauri/build.rs"));
  assert.ok(tauriCommandPolicyErrors({ root: symlinkRoot }).some((error) => error.includes("symlink")));

  const adapterRoot = useFixture(t);
  rmSync(join(adapterRoot, "apps/desktop/src/adapters/tauri/index.ts"));
  assert.ok(tauriCommandPolicyErrors({ root: adapterRoot }).some((error) => error.includes("regular file")));
});

test("rejects every capability broadening and custom permission surface", (t) => {
  const mutations = [
    ["missing commands", (value) => { value.permissions = [["core", "default"].join(":")]; }],
    ["window selector", (value) => { value.windows = ["*"]; }],
    ["extra WebView", (value) => { value.webviews.push("secondary"); }],
  ];
  for (const [name, mutate] of mutations) {
    const root = useFixture(t);
    const path = join(root, "apps/desktop/src-tauri/capabilities/local-app.json");
    const value = JSON.parse(readFileSync(path, "utf8"));
    mutate(value);
    writeFileSync(path, `${JSON.stringify(value)}\n`);
    assert.notDeepEqual(tauriCommandPolicyErrors({ root }), [], name);
  }

  const extraCapabilityRoot = useFixture(t);
  const retiredCapability = ["remote", "browser"].join("-");
  writeFile(
    extraCapabilityRoot,
    `apps/desktop/src-tauri/capabilities/${retiredCapability}.json`,
    `${JSON.stringify({ webviews: [retiredCapability], permissions: [] })}\n`,
  );
  assert.ok(tauriCommandPolicyErrors({ root: extraCapabilityRoot }).some((error) => error.includes("inventory")));

  const permissionRoot = useFixture(t);
  writeFile(permissionRoot, "apps/desktop/src-tauri/permissions/unreviewed.toml", "identifier = \"unreviewed\"\n");
  assert.ok(tauriCommandPolicyErrors({ root: permissionRoot }).some((error) => error.includes("inventory")));

  const capabilitySymlinkRoot = useFixture(t);
  const capabilityPath = join(capabilitySymlinkRoot, "apps/desktop/src-tauri/capabilities/local-app.json");
  rmSync(capabilityPath);
  symlinkSync("missing-capability", capabilityPath);
  assert.ok(tauriCommandPolicyErrors({ root: capabilitySymlinkRoot }).some((error) => error.includes("symlink")));
});

test("rejects JSON, unbounded, or non-aggregate backup IPC composition", (t) => {
  const validRoot = useFixture(t);
  assert.deepEqual(tauriCommandPolicyErrors({ root: validRoot }), []);

  const toVecRoot = useFixture(t);
  const toVecPath = join(toVecRoot, "apps/desktop/src-tauri/src/backup_ipc.rs");
  writeFileSync(toVecPath, readFileSync(toVecPath, "utf8").replace("wire.clone()", "wire.to_vec()"));
  assert.ok(
    tauriCommandPolicyErrors({ root: toVecRoot })
      .some((error) => error.includes("no parse and exactly one bounded copy")),
  );

  const missingCopyRoot = useFixture(t);
  const missingCopyPath = join(missingCopyRoot, "apps/desktop/src-tauri/src/backup_ipc.rs");
  writeFileSync(
    missingCopyPath,
    readFileSync(missingCopyPath, "utf8").replace("Ok(wire.clone())", "Ok(Vec::new())"),
  );
  assert.ok(
    tauriCommandPolicyErrors({ root: missingCopyRoot })
      .some((error) => error.includes("no parse and exactly one bounded copy")),
  );

  const duplicateCopyRoot = useFixture(t);
  const duplicateCopyPath = join(duplicateCopyRoot, "apps/desktop/src-tauri/src/backup_ipc.rs");
  writeFileSync(
    duplicateCopyPath,
    readFileSync(duplicateCopyPath, "utf8").replace(
      "Ok(wire.clone())",
      "let _duplicate = wire.clone(); Ok(wire.clone())",
    ),
  );
  assert.ok(
    tauriCommandPolicyErrors({ root: duplicateCopyRoot })
      .some((error) => error.includes("no parse and exactly one bounded copy")),
  );

  const jsonRoot = useFixture(t);
  writeFile(
    jsonRoot,
    "apps/desktop/src-tauri/src/backup_ipc.rs",
    "const MAX_BACKUP_REQUEST_WIRE_BYTES: usize = 4_096; fn bounded_request_wire() { serde_json::from_slice(); }\n",
  );
  assert.ok(tauriCommandPolicyErrors({ root: jsonRoot }).some((error) => error.includes("raw-wire")));

  const typedRoot = useFixture(t);
  const handlerPath = join(typedRoot, "apps/desktop/src-tauri/src/handler.rs");
  writeFileSync(
    handlerPath,
    readFileSync(handlerPath, "utf8").replace(
      "request: tauri::ipc::Request<'_>",
      "request: BackupExportRequest",
    ),
  );
  assert.ok(tauriCommandPolicyErrors({ root: typedRoot }).some((error) => error.includes("bounded raw IPC")));

  const extraArgumentRoot = useFixture(t);
  const extraArgumentHandlerPath = join(extraArgumentRoot, "apps/desktop/src-tauri/src/handler.rs");
  writeFileSync(
    extraArgumentHandlerPath,
    readFileSync(extraArgumentHandlerPath, "utf8").replace(
      "request: tauri::ipc::Request<'_>, host:",
      "request: tauri::ipc::Request<'_>, authority: bool, host:",
    ),
  );
  assert.ok(
    tauriCommandPolicyErrors({ root: extraArgumentRoot })
      .some((error) => error.includes("bounded raw IPC")),
  );

  const parsedRawRoot = useFixture(t);
  const parsedRawPath = join(parsedRawRoot, "apps/desktop/src-tauri/src/backup_ipc.rs");
  writeFileSync(
    parsedRawPath,
    readFileSync(parsedRawPath, "utf8").replace(
      "Ok(wire.clone())",
      "let _: serde_json::Value = serde_json::from_slice(wire).unwrap(); Ok(wire.clone())",
    ),
  );
  assert.ok(
    tauriCommandPolicyErrors({ root: parsedRawRoot })
      .some((error) => error.includes("no parse and exactly one bounded copy")),
  );

  const splitRoot = useFixture(t);
  const splitHandlerPath = join(splitRoot, "apps/desktop/src-tauri/src/handler.rs");
  writeFileSync(
    splitHandlerPath,
    readFileSync(splitHandlerPath, "utf8").replace(
      "tauri::async_runtime::spawn_blocking(move || aggregate.export_backup(&wire))",
      "tauri::async_runtime::spawn_blocking(|| ()).await; tauri::async_runtime::spawn_blocking(move || aggregate.export_backup(&wire))",
    ),
  );
  assert.ok(tauriCommandPolicyErrors({ root: splitRoot }).some((error) => error.includes("one blocking aggregate call")));

  const sideEffectRoot = useFixture(t);
  const sideEffectHandlerPath = join(sideEffectRoot, "apps/desktop/src-tauri/src/handler.rs");
  writeFileSync(
    sideEffectHandlerPath,
    readFileSync(sideEffectHandlerPath, "utf8").replace(
      "  let aggregate = Arc::clone(host.inner());\n  tauri::async_runtime::spawn_blocking(move || aggregate.export_backup(&wire))",
      "  let aggregate = Arc::clone(host.inner());\n  let _ = std::fs::read(\"unexpected\");\n  tauri::async_runtime::spawn_blocking(move || aggregate.export_backup(&wire))",
    ),
  );

  const postAwaitSideEffectRoot = useFixture(t);
  const postAwaitSideEffectPath = join(postAwaitSideEffectRoot, "apps/desktop/src-tauri/src/handler.rs");
  writeFileSync(
    postAwaitSideEffectPath,
    readFileSync(postAwaitSideEffectPath, "utf8").replace(
      "    .map_err(map_desktop_backup_error)\n}",
      "    .map_err(map_desktop_backup_error)\n    .map(|value| { let _ = std::fs::read(\"unexpected\"); value })\n}",
    ),
  );
  assert.ok(
    tauriCommandPolicyErrors({ root: postAwaitSideEffectRoot })
      .some((error) => error.includes("bounded raw IPC")),
  );

  const statusPostAwaitRoot = useFixture(t);
  const statusPostAwaitPath = join(statusPostAwaitRoot, "apps/desktop/src-tauri/src/handler.rs");
  writeFileSync(
    statusPostAwaitPath,
    readFileSync(statusPostAwaitPath, "utf8").replace(
      "    .map_err(|_| \"BACKUP_STORAGE_REJECTED\".to_owned())\n}",
      "    .map_err(|_| \"BACKUP_STORAGE_REJECTED\".to_owned())\n    .map(|value| { let _ = std::fs::read(\"unexpected\"); value })\n}",
    ),
  );
  assert.ok(
    tauriCommandPolicyErrors({ root: statusPostAwaitRoot })
      .some((error) => error.includes("blocking aggregate query")),
  );
  assert.ok(
    tauriCommandPolicyErrors({ root: sideEffectRoot })
      .some((error) => error.includes("bounded raw IPC")),
  );

  const capturedRequestRoot = useFixture(t);
  const capturedRequestHandlerPath = join(
    capturedRequestRoot,
    "apps/desktop/src-tauri/src/handler.rs",
  );
  writeFileSync(
    capturedRequestHandlerPath,
    readFileSync(capturedRequestHandlerPath, "utf8").replace(
      "tauri::async_runtime::spawn_blocking(move || aggregate.export_backup(&wire))",
      "tauri::async_runtime::spawn_blocking(move || { let _ = request.body(); aggregate.export_backup(&wire) })",
    ),
  );
  assert.ok(
    tauriCommandPolicyErrors({ root: capturedRequestRoot })
      .some((error) => error.includes("bounded raw IPC")),
  );

  const capturedStateRoot = useFixture(t);
  const capturedStateHandlerPath = join(
    capturedStateRoot,
    "apps/desktop/src-tauri/src/handler.rs",
  );
  writeFileSync(
    capturedStateHandlerPath,
    readFileSync(capturedStateHandlerPath, "utf8").replace(
      "tauri::async_runtime::spawn_blocking(move || aggregate.backup_status())",
      "tauri::async_runtime::spawn_blocking(move || { let _ = host.inner(); aggregate.backup_status() })",
    ),
  );
  const capturedStateErrors = tauriCommandPolicyErrors({ root: capturedStateRoot });
  assert.ok(
    capturedStateErrors.some((error) => error.includes("blocking aggregate query"))
      || capturedStateErrors.some((error) => error.includes("bounded raw IPC")),
  );

  const earlyCopyRoot = useFixture(t);
  const earlyCopyPath = join(earlyCopyRoot, "apps/desktop/src-tauri/src/backup_ipc.rs");
  writeFileSync(
    earlyCopyPath,
    readFileSync(earlyCopyPath, "utf8").replace(
      "if !(1..=MAX_BACKUP_REQUEST_WIRE_BYTES).contains(&wire.len()) { return Err(backup_operation_rejected()); }\n  Ok(wire.clone())",
      "let copied = wire.clone();\n  if !(1..=MAX_BACKUP_REQUEST_WIRE_BYTES).contains(&wire.len()) { return Err(backup_operation_rejected()); }\n  Ok(copied)",
    ),
  );
  assert.ok(
    tauriCommandPolicyErrors({ root: earlyCopyRoot })
      .some((error) => error.includes("no parse and exactly one bounded copy")),
  );

  for (const [name, copy] of [
    ["Vec::from", "let _copy = Vec::from(wire.as_slice());"],
    ["iterator collect", "let _copy: Vec<_> = wire.iter().copied().collect();"],
    ["helper copy", "let _copy = duplicate_wire(wire);"],
  ]) {
    const root = useFixture(t);
    const path = join(root, "apps/desktop/src-tauri/src/backup_ipc.rs");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        "  if !(1..=MAX_BACKUP_REQUEST_WIRE_BYTES).contains(&wire.len())",
        `  ${copy}\n  if !(1..=MAX_BACKUP_REQUEST_WIRE_BYTES).contains(&wire.len())`,
      ),
    );
    assert.ok(
      tauriCommandPolicyErrors({ root })
        .some((error) => error.includes("no parse and exactly one bounded copy")),
      name,
    );
  }

  const wrapperCopyRoot = useFixture(t);
  const wrapperCopyPath = join(wrapperCopyRoot, "apps/desktop/src-tauri/src/backup_ipc.rs");
  writeFileSync(
    wrapperCopyPath,
    readFileSync(wrapperCopyPath, "utf8").replace(
      "bounded_raw_body(request.body())",
      "let copied = request.body().clone(); bounded_raw_body(&copied)",
    ),
  );
  assert.ok(
    tauriCommandPolicyErrors({ root: wrapperCopyRoot })
      .some((error) => error.includes("no parse and exactly one bounded copy")),
  );

  const forbiddenRoot = useFixture(t);
  writeFile(
    forbiddenRoot,
    "apps/desktop/src-tauri/src/forbidden.rs",
    "struct BackupAuthoritySnapshot;\n",
  );
  assert.ok(tauriCommandPolicyErrors({ root: forbiddenRoot }).some((error) => error.includes("BackupAuthoritySnapshot")));

  for (const forbidden of [
    "BusinessDatabase",
    "HostStorageBootstrap",
    "AuthorizedWorkspace",
    "VerifiedLocalWorkspaceBinding",
    "CloudflareAuthoritySnapshot",
    "RebootstrapPublication",
    "SyncAuthority",
  ]) {
    const root = useFixture(t);
    writeFile(root, "apps/desktop/src-tauri/src/forbidden.rs", `struct ${forbidden};\n`);
    assert.ok(
      tauriCommandPolicyErrors({ root }).some((error) => error.includes(forbidden)),
      forbidden,
    );
  }

  const featureRoot = useFixture(t);
  writeFile(
    featureRoot,
    "apps/desktop/src-tauri/Cargo.toml",
    "[dependencies]\ngooddealer-secure-host-core = { features = [\"backup-test-adapter\"] }\n",
  );
  assert.ok(tauriCommandPolicyErrors({ root: featureRoot }).some((error) => error.includes("test adapter")));
});
