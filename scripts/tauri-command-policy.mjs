import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, resolve } from "node:path";

const commandName = "[a-z][a-z0-9_]*";
const defaultRoot = resolve(import.meta.dirname, "..");
const reviewedCommands = [
  "cloudflare_connection_activate",
  "cloudflare_connection_status",
  "cloudflare_observation_read",
  "cloudflare_zone_observe",
  "desktop_authentication_begin",
  "desktop_authentication_refresh",
  "desktop_authentication_status",
  "local_asset_library_read",
  "local_backup_artifact_select",
  "local_backup_export",
  "local_backup_restore_begin",
  "local_backup_restore_status",
  "local_business_status",
  "local_conflict_center_read",
  "local_conflict_resolve",
  "local_domain_asset_delete",
  "local_domain_asset_edit",
  "local_domain_asset_provider_bind",
  "local_domain_detail_read",
  "local_sync_status",
];
const reviewedAdapterCommands = reviewedCommands.filter(
  (command) => !command.startsWith("local_backup_"),
);

function unique(values) {
  return [...new Set(values)].sort();
}

function pathState(path) {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isFile()) return "file";
    if (stat.isDirectory()) return "directory";
    return "other";
  } catch (error) {
    return error?.code === "ENOENT" ? "missing" : "unreadable";
  }
}

function requiredRegularFile(root, path, errors) {
  const absolutePath = resolve(root, path);
  const state = pathState(absolutePath);
  if (state !== "file") {
    errors.push(`required Desktop input must be a regular file: ${path} (${state})`);
    return null;
  }
  try {
    return readFileSync(absolutePath, "utf8");
  } catch (error) {
    errors.push(`required Desktop input is unreadable: ${path}`);
    return null;
  }
}

function exactDirectoryEntries(root, path, expectedNames, errors, allowedDirectories = []) {
  const absolutePath = resolve(root, path);
  if (pathState(absolutePath) !== "directory") {
    errors.push(`required Desktop directory must be a real directory: ${path}`);
    return;
  }
  const observed = [];
  for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
    const state = pathState(resolve(absolutePath, entry.name));
    if (state !== "file" && !(state === "directory" && allowedDirectories.includes(entry.name))) {
      errors.push(`Desktop directory entry must be a regular file: ${path}/${entry.name} (${state})`);
    }
    observed.push(entry.name);
  }
  if (JSON.stringify(observed.sort()) !== JSON.stringify([...expectedNames].sort())) {
    errors.push(`Desktop directory inventory differs: ${path}`);
  }
}

function rustSources(root, errors) {
  const sourceRoot = resolve(root, "apps/desktop/src-tauri/src");
  if (pathState(sourceRoot) !== "directory") {
    errors.push("required Desktop Rust source root must be a real directory");
    return [];
  }
  const sources = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const state = pathState(path);
      if (state === "directory") {
        visit(path);
      } else if (state === "file" && extname(path) === ".rs") {
        try {
          sources.push(readFileSync(path, "utf8"));
        } catch (error) {
          errors.push("required Desktop Rust source is unreadable");
        }
      } else if (state !== "file") {
        errors.push("Desktop Rust source tree may not contain non-regular entries");
      }
    }
  }
  visit(sourceRoot);
  return sources;
}

function attributedCommandBlock(sources, command) {
  const marker = new RegExp(`fn\\s+${command}\\b`, "u");
  for (const source of sources) {
    const match = marker.exec(source);
    if (match === null) continue;
    const remainder = source.slice(match.index);
    const nextCommand = remainder.indexOf("\n#[tauri::command]", 1);
    return nextCommand === -1 ? remainder : remainder.slice(0, nextCommand);
  }
  return "";
}

function hasRawBackupCommand(sources, command, aggregateMethod) {
  const source = attributedCommandBlock(sources, command);
  const body = rustFunctionBody(source, command);
  const signature = new RegExp(
    `fn\\s+${command}\\s*\\(\\s*request\\s*:\\s*tauri::ipc::Request\\s*<\\s*'_\\s*>\\s*,\\s*host\\s*:\\s*State\\s*<\\s*'_,\\s*Arc\\s*<\\s*DesktopLocalHost\\s*>\\s*>\\s*,?\\s*\\)`,
    "u",
  );
  const exactBody = new RegExp(
    `^let wire = bounded_request_wire\\(&request\\)\\?; let aggregate = Arc::clone\\(host\\.inner\\(\\)\\); tauri::async_runtime::spawn_blocking\\(move \\|\\| aggregate\\.${aggregateMethod}\\(&wire\\)\\) \\.await \\.map_err\\(\\|_\\| "BACKUP_STORAGE_REJECTED"\\.to_owned\\(\\)\\)\\? \\.map_err\\(map_desktop_backup_error\\)$`,
    "u",
  );
  return signature.test(source)
    && body !== ""
    && exactBody.test(normalizeRust(body));
}

function normalizeRust(source) {
  return source.replace(/\s+/gu, " ").trim();
}

function rustFunctionBody(source, name) {
  const marker = new RegExp(`\\bfn\\s+${name}\\b`, "u").exec(source);
  if (marker === null) return "";
  const open = source.indexOf("{", marker.index);
  if (open < 0) return "";
  const close = matchingBrace(source, open);
  return close < 0 ? "" : source.slice(open + 1, close);
}

function matchingBrace(source, open) {
  let depth = 0;
  let state = "code";
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line") {
      if (char === "\n") state = "code";
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") { state = "code"; index += 1; }
      continue;
    }
    if (state === "string" || state === "char") {
      if (char === "\\") { index += 1; continue; }
      if ((state === "string" && char === '"') || (state === "char" && char === "'")) state = "code";
      continue;
    }
    if (char === "/" && next === "/") { state = "line"; index += 1; continue; }
    if (char === "/" && next === "*") { state = "block"; index += 1; continue; }
    if (char === '"') { state = "string"; continue; }
    if (char === "'" && source[index + 2] === "'") { state = "char"; continue; }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function listFromRustCall(source, callPattern) {
  const match = source.match(callPattern);
  if (!match) return [];
  return unique([...match[1].matchAll(new RegExp(`"(${commandName})"`, "g"))].map((item) => item[1]));
}

export function appManifestCommands(source) {
  return listFromRustCall(source, /AppManifest::new\(\)\.commands\(&\[([\s\S]*?)\]\)/);
}

export function handlerCommands(source) {
  const match = source.match(/generate_handler!\s*\[([\s\S]*?)\]/);
  if (!match) return [];
  return unique(
    match[1]
      .split(",")
      .map((value) => value.trim().split("::").at(-1))
      .filter((value) => new RegExp(`^${commandName}$`).test(value ?? "")),
  );
}

export function attributedCommands(sources) {
  return unique(
    sources.flatMap((source) => {
      const commands = [];
      const pattern = new RegExp(
        `#\\s*\\[\\s*tauri::command\\s*\\]\\s*(?:#\\s*\\[[^\\]]+\\]\\s*)*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+(${commandName})`,
        "g",
      );
      for (const match of source.matchAll(pattern)) commands.push(match[1]);
      return commands;
    }),
  );
}

export function capabilityCommands(capability) {
  if (!Array.isArray(capability.permissions)) return [];
  return unique(
    capability.permissions
      .filter((permission) => typeof permission === "string" && permission.startsWith("allow-"))
      .map((permission) => permission.slice("allow-".length).replaceAll("-", "_")),
  );
}

export function adapterCommands(source) {
  return unique([...source.matchAll(new RegExp(`"(${commandName})"`, "g"))]
    .map((match) => match[1])
    .filter((command) => command.startsWith("local_")
      || command.startsWith("desktop_authentication_")
      || command.startsWith("cloudflare_")));
}

export function tauriCommandPolicyErrors({ root = defaultRoot } = {}) {
  const errors = [];
  exactDirectoryEntries(root, "apps/desktop/src-tauri/capabilities", ["local-app.json"], errors);
  exactDirectoryEntries(root, "apps/desktop/src-tauri/permissions", ["autogenerated"], errors, ["autogenerated"]);
  exactDirectoryEntries(
    root,
    "apps/desktop/src-tauri/permissions/autogenerated",
    reviewedCommands.map((command) => `${command}.toml`),
    errors,
  );
  const buildSource = requiredRegularFile(root, "apps/desktop/src-tauri/build.rs", errors);
  const mainSource = requiredRegularFile(root, "apps/desktop/src-tauri/src/main.rs", errors);
  const capabilitySource = requiredRegularFile(
    root,
    "apps/desktop/src-tauri/capabilities/local-app.json",
    errors,
  );
  const adapterPath = "apps/desktop/src/adapters/tauri/index.ts";
  const adapterSource = requiredRegularFile(root, adapterPath, errors);
  const desktopManifest = requiredRegularFile(root, "apps/desktop/src-tauri/Cargo.toml", errors);
  const backupIpcSource = requiredRegularFile(
    root,
    "apps/desktop/src-tauri/src/backup_ipc.rs",
    errors,
  );
  const sources = rustSources(root, errors);
  if (
    buildSource === null ||
    mainSource === null ||
    capabilitySource === null ||
    adapterSource === null ||
    desktopManifest === null ||
    backupIpcSource === null ||
    errors.length > 0
  ) {
    return errors;
  }

  let capability;
  try {
    capability = JSON.parse(capabilitySource);
  } catch (error) {
    errors.push("Desktop capability input must contain valid JSON");
    return errors;
  }
  if (
    capability === null ||
    typeof capability !== "object" ||
    Array.isArray(capability)
  ) {
    errors.push("Desktop capability inputs must be objects");
    return errors;
  }

  const sets = {
    appManifest: appManifestCommands(buildSource),
    handler: handlerCommands(mainSource),
    attributed: attributedCommands(sources),
    capability: capabilityCommands(capability),
    adapter: adapterCommands(adapterSource),
  };
  for (const [name, commands] of Object.entries(sets)) {
    const expected = name === "adapter" ? reviewedAdapterCommands : reviewedCommands;
    if (JSON.stringify(commands) !== JSON.stringify(expected)) {
      errors.push(`${name} command set differs from reviewed Desktop commands: ${commands.join(", ")}`);
    }
  }
  if (!Array.isArray(capability.webviews) || capability.webviews.length !== 1 || capability.webviews[0] !== "local-app") {
    errors.push("local-app capability must target only the explicit local-app WebView");
  }
  if (Object.hasOwn(capability, "windows")) {
    errors.push("local-app capability must not use window-level matching");
  }
  if (!Array.isArray(capability.permissions) || capability.permissions[0] !== "core:default") {
    errors.push("local-app capability must include only the reviewed core and local-business permissions");
  }
  const expectedCapabilityKeys = ["$schema", "description", "identifier", "permissions", "webviews"];
  if (JSON.stringify(Object.keys(capability).sort()) !== JSON.stringify(expectedCapabilityKeys)) {
    errors.push("local-app capability must have the exact reviewed shape");
  }
  if (capability.$schema !== "../gen/schemas/desktop-schema.json") {
    errors.push("local-app capability must use the checked-in Desktop schema");
  }
  if (capability.identifier !== "local-app" || capability.description !== "Local application shell with narrow business and authentication commands.") {
    errors.push("local-app capability identity differs from the reviewed shell");
  }

  const rustSource = sources.join("\n");
  if (
    mainSource.match(/DesktopLocalHost::production\s*\(/gu)?.length !== 1 ||
    !/app\.manage\s*\(\s*Arc::clone\s*\(\s*&local_host\s*\)\s*\)/u.test(mainSource)
  ) {
    errors.push("Desktop startup must construct and manage exactly one local-host aggregate");
  }
  const statusSource = attributedCommandBlock(sources, "local_backup_restore_status");
  const statusSignature = statusSource.match(
    /fn\s+local_backup_restore_status\s*\(([\s\S]*?)\)\s*->/u,
  )?.[1] ?? "";
  const exactStatusSignature = /^\s*host\s*:\s*State\s*<\s*'_,\s*Arc\s*<\s*DesktopLocalHost\s*>\s*>\s*,?\s*$/u;
  const statusBody = rustFunctionBody(statusSource, "local_backup_restore_status");
  const exactStatusBody = /^let aggregate = Arc::clone\(host\.inner\(\)\); tauri::async_runtime::spawn_blocking\(move \|\| aggregate\.backup_status\(\)\) \.await \.map_err\(\|_\| "BACKUP_STORAGE_REJECTED"\.to_owned\(\)\)$/u;
  if (
    !exactStatusSignature.test(statusSignature) ||
    !exactStatusBody.test(normalizeRust(statusBody))
  ) {
    errors.push("backup status must remain an argument-free blocking aggregate query");
  }
  for (const [command, method] of [
    ["local_backup_export", "export_backup"],
    ["local_backup_artifact_select", "inspect_backup"],
    ["local_backup_restore_begin", "restore_backup"],
  ]) {
    if (!hasRawBackupCommand(sources, command, method)) {
      errors.push(`${command} must use bounded raw IPC and one blocking aggregate call`);
    }
  }
  for (const required of [
    "const MAX_BACKUP_REQUEST_WIRE_BYTES: usize = 4_096;",
    "let InvokeBody::Raw(wire) = body else",
    "(1..=MAX_BACKUP_REQUEST_WIRE_BYTES).contains(&wire.len())",
  ]) {
    if (!backupIpcSource.includes(required)) {
      errors.push("backup raw-wire admission no longer checks before its bounded copy");
      break;
    }
  }
  const backupAdmissionSource = backupIpcSource.split("#[cfg(test)]", 1)[0];
  const wrapperBody = rustFunctionBody(backupAdmissionSource, "bounded_request_wire");
  const boundedBody = rustFunctionBody(backupAdmissionSource, "bounded_raw_body");
  const exactWrapper = "bounded_raw_body(request.body())";
  const exactBoundedBody = "let InvokeBody::Raw(wire) = body else { return Err(backup_operation_rejected()); }; if !(1..=MAX_BACKUP_REQUEST_WIRE_BYTES).contains(&wire.len()) { return Err(backup_operation_rejected()); } Ok(wire.clone())";
  if (
    normalizeRust(wrapperBody) !== exactWrapper ||
    normalizeRust(boundedBody) !== exactBoundedBody
  ) {
    errors.push("backup raw-wire admission must perform no parse and exactly one bounded copy");
  }
  for (const forbidden of [
    "AuthorizedWorkspace",
    "BackupAuthoritySnapshot",
    "BackupCryptoPort",
    "BackupProjection",
    "BackupRuntime",
    "DesktopBackupBinding",
    "DesktopBackupContainer",
    "IsolatedBackupCandidate",
    "BusinessDatabase",
    "CloudflareAuthoritySnapshot",
    "HostStorageBootstrap",
    "RebootstrapPublication",
    "SyncAuthority",
    "VerifiedLocalWorkspaceBinding",
    "authority_is_current",
  ]) {
    if (rustSource.includes(forbidden)) {
      errors.push(`Desktop local-host internals must not expose ${forbidden}`);
    }
  }
  if (/gooddealer_local_storage::backup::/u.test(rustSource)) {
    errors.push("Desktop must not deep-import the local-storage backup implementation");
  }
  if (desktopManifest.includes("backup-test-adapter")) {
    errors.push("Desktop must not activate a backup test adapter feature");
  }
  return errors;
}
