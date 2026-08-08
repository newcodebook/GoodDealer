const commandName = "[a-z][a-z0-9_]*";

function unique(values) {
  return [...new Set(values)].sort();
}

function setDifference(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
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
  return unique(
    [...source.matchAll(new RegExp(`_COMMAND\\s*=\\s*"(${commandName})"`, "g"))].map(
      (match) => match[1],
    ),
  );
}

export function tauriCommandPolicyErrors({
  buildSource,
  mainSource,
  rustSources,
  capability,
  adapterSource,
}) {
  const sets = {
    appManifest: appManifestCommands(buildSource),
    handler: handlerCommands(mainSource),
    attributed: attributedCommands(rustSources),
    capability: capabilityCommands(capability),
    adapter: adapterCommands(adapterSource),
  };
  const errors = [];
  const expected = sets.appManifest;

  if (expected.length === 0) errors.push("AppManifest must declare at least one reviewed app command");
  for (const [name, commands] of Object.entries(sets).slice(1)) {
    const missing = setDifference(expected, commands);
    const extra = setDifference(commands, expected);
    if (missing.length || extra.length) {
      errors.push(
        `${name} command set differs from AppManifest (missing: ${missing.join(",") || "none"}; extra: ${extra.join(",") || "none"})`,
      );
    }
  }

  if (!Array.isArray(capability.webviews) || capability.webviews.join(",") !== "local-app") {
    errors.push("local-app capability must target only the explicit local-app WebView");
  }
  if ("windows" in capability) {
    errors.push("local-app capability must not use window-level matching");
  }
  const nonAppPermissions = (capability.permissions ?? []).filter(
    (permission) => permission !== "core:default" && !(typeof permission === "string" && permission.startsWith("allow-")),
  );
  if (nonAppPermissions.length > 0) {
    errors.push("local-app capability contains an unreviewed plugin or scoped permission");
  }
  if (!capability.permissions?.includes("core:default")) {
    errors.push("local-app capability must retain core:default");
  }

  return errors;
}
