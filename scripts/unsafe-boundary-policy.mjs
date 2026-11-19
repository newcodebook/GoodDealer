import { readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

// ADR-0006: only fixed OS power notifications and continuous-clock sampling may use FFI.
export const unsafeCodeAllowlist = Object.freeze([
  "crates/secure-host-core/src/native_power/windows.rs",
  "crates/secure-host-core/src/native_power/macos.rs",
  "crates/secure-host-core/src/native_continuous_clock/windows.rs",
  "crates/secure-host-core/src/native_continuous_clock/macos.rs",
]);

const unsafeOverridePattern = /\b(allow|expect|warn)\s*\(([^()]*)\)/gu;
const unsafeLintPattern = /(?:^|,)\s*unsafe_code\s*(?=,|$)/u;

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split(/\r\n|\r|\n/u).length;
}

export function unsafeCodeBoundaryErrors(sources, allowlist = unsafeCodeAllowlist) {
  const allowedPaths = new Set(allowlist);
  const errors = [];

  for (const { path, source } of sources) {
    for (const match of source.matchAll(unsafeOverridePattern)) {
      if (!unsafeLintPattern.test(match[2]) || allowedPaths.has(path)) continue;

      errors.push(
        `${path}:${lineNumberAt(source, match.index)}: ${match[1]}(unsafe_code) is forbidden; `
          + "only the four ADR-0006 power/clock files are admitted",
      );
    }
  }

  return errors;
}

function rustSources(directory, root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) return rustSources(absolutePath, root);
    if (!entry.isFile() || extname(entry.name) !== ".rs") return [];

    return [{
      path: relative(root, absolutePath).replaceAll("\\", "/"),
      source: readFileSync(absolutePath, "utf8"),
    }];
  });
}

export function repositoryUnsafeCodeBoundaryErrors(root) {
  return unsafeCodeBoundaryErrors(rustSources(resolve(root, "crates"), root));
}
