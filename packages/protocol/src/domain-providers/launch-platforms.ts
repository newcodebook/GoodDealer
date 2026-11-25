import { z } from "zod";

/**
 * ADR-0027's twelve launch platforms, the only Provider kinds a Host read may report and the
 * platforms the capability manifest covers. Every TypeScript contract takes its platform set from
 * here, and the Desktop pins it to the Host's `LAUNCH_PLATFORMS`, so adding or retiring a platform
 * is one change per runtime.
 */
export const launchPlatformKindSchema = z.enum([
  "22cn", "afternic", "aliyun", "atom", "cloudflare", "dynadot", "ename", "godaddy", "namecheap", "porkbun", "sedo", "spaceship",
]);

export type LaunchPlatformKind = z.infer<typeof launchPlatformKindSchema>;
