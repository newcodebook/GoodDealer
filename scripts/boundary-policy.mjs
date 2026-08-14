export const concreteConnectorPackages = new Set([
  "@gooddealer/connector-afternic",
  "@gooddealer/connector-atom",
  "@gooddealer/connector-cloudflare",
  "@gooddealer/connector-spaceship",
]);

function isOwnConnectorTest(localPath, specifier) {
  const connector = specifier.replace("@gooddealer/connector-", "");
  return (
    concreteConnectorPackages.has(specifier) &&
    localPath.startsWith(`packages/connectors/${connector}/test/`)
  );
}

export function importBoundaryErrors(localPath, specifier) {
  const errors = [];
  const isConcreteConnector = concreteConnectorPackages.has(specifier);
  const isDesktopCompositionRoot = localPath === "apps/desktop/src/composition-root.ts";
  const isCloudRoute = localPath.startsWith("apps/cloud/src/entrypoints/routes/");
  const isPublicEntrypoint =
    localPath === "apps/cloud/src/entrypoints/http.ts"
    || localPath.startsWith("apps/cloud/src/entrypoints/routes/public/");
  const isAdminEntrypoint =
    localPath === "apps/cloud/src/entrypoints/admin-http.ts"
    || localPath.startsWith("apps/cloud/src/entrypoints/routes/admin/");

  if (isConcreteConnector && !isDesktopCompositionRoot && !isOwnConnectorTest(localPath, specifier)) {
    errors.push("concrete connector import is only allowed in the desktop composition root or its own tests");
  }

  if (
    specifier === "@gooddealer/protocol/admin" &&
    /^(apps\/desktop|apps\/account-web|packages\/client-core|packages\/cloud-client|packages\/connectors)\//.test(localPath)
  ) {
    errors.push("protocol/admin is forbidden in this trust domain");
  }

  if (
    localPath.startsWith("apps/cloud/") &&
    (specifier.startsWith("@gooddealer/client-core") ||
      isConcreteConnector ||
      specifier.startsWith("@gooddealer/browser-automation"))
  ) {
    errors.push("Cloud cannot import client-core, connectors, or browser automation");
  }

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

  if (localPath.startsWith("apps/account-web/") && specifier.startsWith("@gooddealer/client-core")) {
    errors.push("account-web cannot import client-core");
  }

  if (
    localPath.startsWith("apps/admin-web/") &&
    (specifier.startsWith("@gooddealer/client-core") ||
      specifier.startsWith("@gooddealer/cloud-client") ||
      isConcreteConnector ||
      (specifier.startsWith("@gooddealer/protocol") && specifier !== "@gooddealer/protocol/admin"))
  ) {
    errors.push("admin-web can only use protocol/admin and its own API adapter");
  }

  if (
    localPath.startsWith("packages/client-core/") &&
    (specifier.startsWith("@tauri-apps/") || specifier.startsWith("@gooddealer/cloud-client"))
  ) {
    errors.push("client-core must remain host independent");
  }

  return errors;
}

export function cloudManifestErrors(source) {
  return /@gooddealer\/(?:client-core|connector-(?:afternic|atom|cloudflare|spaceship))/.test(source)
    ? ["apps/cloud/package.json cannot depend on client-core or concrete connectors"]
    : [];
}

export function secureHostManifestErrors(source) {
  return /\b(?:tauri|wry|local-storage|automation-host)\b/.test(source)
    ? ["secure-host-core cannot depend on Tauri, Wry, local-storage, or automation-host"]
    : [];
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
