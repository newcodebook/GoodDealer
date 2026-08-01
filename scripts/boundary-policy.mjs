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

  if (localPath.startsWith("apps/account-web/") && specifier.startsWith("@gooddealer/client-core")) {
    errors.push("account-web cannot import client-core");
  }

  if (
    localPath.startsWith("apps/admin-web/") &&
    (specifier.startsWith("@gooddealer/client-core") ||
      specifier.startsWith("@gooddealer/cloud-client") ||
      isConcreteConnector)
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
