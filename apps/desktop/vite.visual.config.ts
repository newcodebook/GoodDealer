import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const fixtureRoot = fileURLToPath(new URL("./visual-fixtures", import.meta.url));

export default defineConfig({
  root: fixtureRoot,
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("./dist-visual", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./visual-fixtures/index.html", import.meta.url)),
        signin: fileURLToPath(new URL("./visual-fixtures/signin.html", import.meta.url)),
        onboarding: fileURLToPath(new URL("./visual-fixtures/onboarding.html", import.meta.url)),
      },
    },
  },
});
