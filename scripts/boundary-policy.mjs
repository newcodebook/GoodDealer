export function importBoundaryErrors(localPath, specifier) {
  const errors = [];
  const isCloudRoute = localPath.startsWith("apps/cloud/src/entrypoints/routes/");
  const isPublicEntrypoint =
    localPath === "apps/cloud/src/entrypoints/http.ts"
    || localPath.startsWith("apps/cloud/src/entrypoints/routes/public/");
  const isAdminEntrypoint =
    localPath === "apps/cloud/src/entrypoints/admin-http.ts"
    || localPath.startsWith("apps/cloud/src/entrypoints/routes/admin/");

  if (isPublicEntrypoint && /(?:routes\/admin|staff-session|modules\/admin-access)/i.test(specifier)) {
    errors.push("the Public composition root cannot import the Admin or staff surface");
  }

  if (isAdminEntrypoint && /(?:routes\/public|public-session)/i.test(specifier)) {
    errors.push("the Admin composition root cannot import the Public session or route surface");
  }

  if (localPath.startsWith("apps/cloud/src/entrypoints/adapter/") && /(?:\/ports\/|\/routes\/|\/modules\/|\/db(?:\/|$))/.test(specifier)) {
    errors.push("Cloud entrypoint adapters are mechanism-only and cannot import authority-bearing ports, routes, modules, or db");
  }

  if (isCloudRoute) {
    const allowed =
      specifier.startsWith("@gooddealer/protocol")
      || /^(?:\.\.\/)+adapter\//.test(specifier)
      || /^(?:\.\.\/)+ports\//.test(specifier)
      || /^(?:\.\.\/)+modules\/[^/]+\/index(?:\.[a-z]+)?$/.test(specifier);
    if (!allowed) {
      errors.push("Cloud routes may import only protocol, entrypoint adapters/ports, or a module index export");
    }
  }

  if (
    localPath.startsWith("apps/cloud/src/modules/")
    && (specifier === "fastify" || specifier === "node:http" || specifier === "http")
  ) {
    errors.push("Cloud business modules cannot import an HTTP framework or network primitive");
  }

  if (
    localPath.startsWith("packages/client-core/") &&
    (specifier.startsWith("@tauri-apps/") || specifier.startsWith("@gooddealer/cloud-client"))
  ) {
    errors.push("client-core must remain host independent");
  }

  return errors;
}

export function cloudEntrypointSourceErrors(localPath, source) {
  const errors = [];

  if (
    localPath.startsWith("apps/cloud/src/entrypoints/adapter/")
    && /(?:["']gd_(?:staff_)?session["']|\b(?:PUBLIC|STAFF)_SESSION_COOKIE\b|["']admin:[^"']+["'])/.test(source)
  ) {
    errors.push("Cloud entrypoint adapters cannot own cookie names, session verifier constants, or scope constants");
  }

  if (localPath.startsWith("apps/cloud/src/modules/")) {
    const importsFastify = /\bfrom\s+["']fastify["']|\brequire\s*\(\s*["']fastify["']\s*\)/.test(source);
    const invokesNetwork = /\b(?:fastify|fetch)\s*\(/.test(source);
    const registersRoute = /\b(?:app|server|fastify)\s*\.\s*(?:delete|get|head|listen|options|patch|post|put|register|route)\s*\(/.test(source);
    if (importsFastify || invokesNetwork || registersRoute) {
      errors.push("Cloud business modules cannot import Fastify, register routes, or invoke network primitives");
    }
  }

  return errors;
}
