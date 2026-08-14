/**
 * Ambient module declaration for CSS side-effect imports (e.g. `import "./button.css"`).
 * Each component colocates and imports its own stylesheet; the consuming app's bundler
 * (Vite, in every current GoodDealer app) resolves and emits it. This declaration only
 * satisfies `tsc --noEmit` typecheck — it has no runtime behavior of its own.
 */
declare module "*.css" {
  const noExport: undefined;
  export default noExport;
}
