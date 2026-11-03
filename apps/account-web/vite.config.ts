import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

import { parseAccountWebEnvironment } from "./src/app/account-environment.ts";

// Production build of the deployed page. The mock design host is built only by vite.visual.config.ts.
// An unset target builds for development (Stripe test mode); an invalid one fails the build.
const environment = parseAccountWebEnvironment(process.env.GOODDEALER_ACCOUNT_WEB_ENVIRONMENT ?? "development");

export default defineConfig({
  // Absolute asset URLs: the same index.html is served on /billing/success and /billing/cancel.
  base: "/",
  // The page ships only its own files; there is no static public directory.
  publicDir: false,
  define: {
    __GOODDEALER_ACCOUNT_WEB_ENVIRONMENT__: JSON.stringify(environment),
  },
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    // No data: URIs, so the origin's CSP can stay at 'self' for images and fonts.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: fileURLToPath(new URL("./index.html", import.meta.url)),
    },
  },
});
