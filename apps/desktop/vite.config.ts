import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      // Production has one Tauri entry. The visual catalog is built only by vite.visual.config.ts.
      input: fileURLToPath(new URL("./index.html", import.meta.url)),
    },
  },
});
