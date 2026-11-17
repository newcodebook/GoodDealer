import { launchPlatformKindSchema, type LaunchPlatformKind } from "@gooddealer/protocol/domain-providers";

/** ADR-0027's eight launch platforms, declared once in the protocol for every TypeScript contract. */
export { launchPlatformKindSchema };
export type { LaunchPlatformKind };

/** Platform brand names; they are proper nouns and are not translated. */
export const launchPlatformNames: Readonly<Record<LaunchPlatformKind, string>> = {
  afternic: "Afternic",
  atom: "Atom",
  cloudflare: "Cloudflare",
  dynadot: "Dynadot",
  godaddy: "GoDaddy",
  namecheap: "Namecheap",
  porkbun: "Porkbun",
  spaceship: "Spaceship",
};
