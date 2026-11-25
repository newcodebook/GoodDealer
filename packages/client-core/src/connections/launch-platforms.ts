import { launchPlatformKindSchema, type LaunchPlatformKind } from "@gooddealer/protocol/domain-providers";

/** ADR-0027's launch platforms, declared once in the protocol for every TypeScript contract. */
export { launchPlatformKindSchema };
export type { LaunchPlatformKind };

/** Platform brand names; they are proper nouns and are not translated. */
export const launchPlatformNames: Readonly<Record<LaunchPlatformKind, string>> = {
  "22cn": "22.cn",
  afternic: "Afternic",
  aliyun: "Aliyun",
  atom: "Atom",
  cloudflare: "Cloudflare",
  dynadot: "Dynadot",
  ename: "eName",
  godaddy: "GoDaddy",
  namecheap: "Namecheap",
  porkbun: "Porkbun",
  sedo: "Sedo",
  spaceship: "Spaceship",
};
