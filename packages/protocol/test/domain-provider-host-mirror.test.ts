import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  domainProviderCapabilityCatalog,
  domainProviderCapabilityManifest,
  launchPlatformKindSchema,
} from "@gooddealer/protocol/domain-providers";

/**
 * The per-platform Services in `secure-host-core` mirror this package's Provider inventory
 * (catalog, platforms, each Service's implemented list). Rust cannot import the protocol, so these
 * tests read the Rust sources and hold the mirror to the protocol.
 */
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const services = `${repository}crates/secure-host-core/src/provider_services/`;

/** Rust source without its test module, where an independent oracle may spell values out. */
function source(path: string): string {
  return readFileSync(path, "utf8").replace(/#\[cfg\(test\)\]\s*mod tests \{[\s\S]*$/u, "");
}

const snake = (variant: string) => variant.replace(/(?<=[a-z])(?=[A-Z])/gu, "_").toLowerCase();

function serviceCatalog() {
  const text = source(`${services}mod.rs`);
  return [...text.matchAll(/\(\s*C::(\w+),\s*"([^"]+)",\s*(\w+),\s*(\w+),?\s*\)/gu)].map((match) => ({
    variant: match[1]!,
    id: match[2]!,
    role: match[3]!.toLowerCase(),
    effect: match[4]!.toLowerCase(),
  }));
}

/** `Self::Variant => "kind"` pairs from `ProviderPlatform::kind`, in source order. */
function servicePlatforms() {
  const text = source(`${services}mod.rs`);
  const body = /pub\(crate\) fn kind\(self\) -> &'static str \{([\s\S]*?)\n {4}\}/u.exec(text)?.[1] ?? "";
  return [...body.matchAll(/Self::(\w+) => "([^"]+)"/gu)].map((match) => ({ variant: match[1]!, kind: match[2]! }));
}

describe("Host Provider Services mirror the protocol inventory", () => {
  it("catalog: same ids, roles and effects, in order, without connection.manage", () => {
    expect(serviceCatalog().map(({ variant: _variant, ...rest }) => rest)).toEqual(
      domainProviderCapabilityCatalog
        .filter((capability) => capability.role !== null)
        .map((capability) => ({ id: capability.id, role: capability.role, effect: capability.effect })),
    );
  });

  it("platforms: one Service per launch platform, in the protocol's order", () => {
    const text = source(`${services}mod.rs`);
    const variants = /pub\(crate\) enum ProviderPlatform \{([^}]*)\}/u.exec(text)?.[1] ?? "";
    const platforms = servicePlatforms();
    expect(platforms.map((platform) => platform.kind)).toEqual(launchPlatformKindSchema.options);
    expect([...variants.matchAll(/(\w+),/gu)].map((match) => match[1])).toEqual(platforms.map((platform) => platform.variant));
    const flat = text.replace(/\s+/gu, " ");
    for (const { variant } of platforms) {
      const module = snake(variant);
      expect(source(`${services}${module}.rs`)).toContain(`pub(super) struct ${variant}Service;`);
      expect(flat).toContain(`mod ${module};`);
      expect(flat).toContain(`ProviderPlatform::${variant} => ${module}::${variant}Service::manifest(capability)`);
    }
  });

  it("each Service implements exactly what the manifest says is implemented locally", () => {
    const byVariant = new Map(serviceCatalog().map((entry) => [entry.variant, entry.id]));
    for (const { variant, kind } of servicePlatforms()) {
      const list = /const IMPLEMENTED: &'static \[ProviderCapability\] =\s*&\[([^\]]*)\];/u
        .exec(source(`${services}${snake(variant)}.rs`))?.[1];
      expect(list, kind).toBeDefined();
      const implemented = [...(list ?? "").matchAll(/ProviderCapability::(\w+)/gu)]
        .map((match) => byVariant.get(match[1]!));
      // Every listed item must be spelled `ProviderCapability::X`, so none escapes the comparison.
      expect(implemented.length, kind).toBe((list ?? "").split(",").filter((item) => item.trim() !== "").length);
      expect(implemented.sort(), kind).toEqual(domainProviderCapabilityManifest
        .filter((entry) => entry.platform === kind && entry.reason === "qualification_pending")
        .map((entry) => entry.capabilityId)
        .sort());
    }
  });
});
