import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { launchPlatformKindSchema, launchPlatformNames } from "@gooddealer/client-core";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const hostReads = join(repository, "crates/local-storage/src/active_workspace/");

/** Source files under `root`, recursively, without test code: tests may list the platforms as an independent oracle. */
function sources(root: string, extension: string): { readonly path: string; readonly text: string }[] {
  return readdirSync(join(repository, root), { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(extension) && !path.endsWith(`.test${extension}`))
    .map((path) => {
      const text = readFileSync(join(repository, root, path), "utf8");
      return { path: relative(repository, join(repository, root, path)).split(sep).join("/"), text: text.replace(/#\[cfg\(test\)\]\s*mod tests \{[\s\S]*$/u, "") };
    });
}

describe("ADR-0027 launch platforms", () => {
  it("are the same eight on the Host and in every Renderer read contract", () => {
    const host = readFileSync(`${hostReads}launch_platforms.rs`, "utf8");
    const list = /pub\(crate\) const LAUNCH_PLATFORMS: \[&str; 8\] = \[([^\]]*)\];/u.exec(host)?.[1];
    expect(list).toBeDefined();
    const hostKinds = [...(list ?? "").matchAll(/"([a-z]+)"/gu)].map((match) => match[1]);
    expect(hostKinds).toEqual(launchPlatformKindSchema.options);
    expect(Object.keys(launchPlatformNames).sort()).toEqual([...launchPlatformKindSchema.options].sort());
  });

  it("are declared once per runtime rather than copied into each read", () => {
    // A copied list could drift from the one pinned above, so no other source may spell out the
    // platforms; "namecheap" is the marker because no other identifier or copy uses that word.
    const copies = [...sources("crates/local-storage/src", ".rs"), ...sources("packages/client-core/src", ".ts")]
      .filter((file) => file.text.includes('"namecheap"'))
      .map((file) => file.path);
    expect(copies.sort()).toEqual([
      "crates/local-storage/src/active_workspace/launch_platforms.rs",
      "packages/client-core/src/connections/launch-platforms.ts",
    ]);
  });
});
