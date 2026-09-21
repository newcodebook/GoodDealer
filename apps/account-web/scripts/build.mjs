import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(packageRoot, "dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: [join(packageRoot, "src", "browser.ts")],
  bundle: true,
  format: "esm",
  minify: true,
  sourcemap: false,
  outfile: join(output, "app.js"),
  platform: "browser",
  target: ["es2022"],
});
await cp(join(packageRoot, "public"), output, { recursive: true });
