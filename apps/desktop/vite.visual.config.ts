import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// The mock design host renders every Desktop screen from typed mock data. It is a separate Vite
// root so its fixtures never enter the production graph built by vite.config.ts.
const fixtureRoot = fileURLToPath(new URL("./visual-fixtures", import.meta.url));

export default defineConfig({
  root: fixtureRoot,
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("./dist-visual", import.meta.url)),
    emptyOutDir: true,
  },
});
