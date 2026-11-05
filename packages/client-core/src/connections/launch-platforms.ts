import { z } from "zod";

/**
 * ADR-0027's eight launch platforms, the only Provider kinds a Host read may report. Every read
 * contract takes its platform set from here, and the desktop pins it to the Host's
 * `LAUNCH_PLATFORMS`, so adding or retiring a platform is one change per runtime.
 */
export const launchPlatformKindSchema = z.enum([
  "afternic", "atom", "cloudflare", "dynadot", "godaddy", "namecheap", "porkbun", "spaceship",
]);

export type LaunchPlatformKind = z.infer<typeof launchPlatformKindSchema>;

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
