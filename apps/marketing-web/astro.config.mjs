// @ts-check
import { defineConfig } from "astro/config";

// Static marketing site (top-of-funnel landing page). No server output, no islands —
// every page is prerendered HTML; the only client JS is a few vanilla <script> blocks
// ported 1:1 from the brand/ui_kits/marketing-web reference (see that kit's README).
export default defineConfig({
  output: "static",
  vite: {
    build: {
      // Keep imported logos and the favicon as emitted local assets. Data URLs obscure
      // the static asset graph and make origin/asset-closure checks less meaningful.
      assetsInlineLimit: 0,
    },
  },
});
