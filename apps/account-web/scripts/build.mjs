import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const environment = process.env.GOODDEALER_ACCOUNT_WEB_ENVIRONMENT ?? "development";
const environmentLabels = {
  development: "DEVELOPMENT · STRIPE TEST MODE",
  staging: "STAGING · TEST TRANSACTIONS",
  production: "PRODUCTION",
};
if (!Object.hasOwn(environmentLabels, environment)) {
  throw new TypeError("GOODDEALER_ACCOUNT_WEB_ENVIRONMENT is invalid");
}
const htmlPath = join(output, "index.html");
const html = await readFile(htmlPath, "utf8");
await writeFile(htmlPath, html.replace("ACCOUNT WEB ENVIRONMENT", environmentLabels[environment]), "utf8");
