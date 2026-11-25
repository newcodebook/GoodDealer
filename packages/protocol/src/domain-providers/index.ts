/**
 * Domain Provider inventory shared by every TypeScript runtime: the ADR-0027 launch platforms,
 * their four roles, the capability catalog and the per-platform manifest. It carries no Provider
 * wire, endpoint or credential, so the client domain may depend on it; Provider wire contracts stay
 * in `./connectors`, which the client domain may not import.
 */
export { launchPlatformKindSchema } from "./launch-platforms";
export type { LaunchPlatformKind } from "./launch-platforms";
export {
  DOMAIN_PROVIDER_CAPABILITY_CATALOG_VERSION,
  domainProviderCapabilityCatalog,
  domainProviderCapabilityIdSchema,
  domainProviderRoles,
  domainProviderRoleSchema,
} from "./domain-capabilities";
export type { DomainProviderCapabilityId, DomainProviderRole } from "./domain-capabilities";
export {
  DOMAIN_PROVIDER_CAPABILITY_MANIFEST_VERSION,
  domainProviderCapabilityManifest,
  domainProviderManifestEntry,
  domainProviderManifestEntrySchema,
  domainProviderUnavailableReasonSchema,
} from "./capability-manifest";
export type { DomainProviderManifestEntry, DomainProviderUnavailableReason } from "./capability-manifest";
