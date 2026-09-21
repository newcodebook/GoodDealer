import { createHash } from "node:crypto";

import type { CommercialProvider } from "./commercial-domain";

/** One canonical transcript owns Provider resource identity across dispatch, webhook, and recovery paths. */
export function providerResourceBindingDigest(
  provider: CommercialProvider,
  resourceKind: string,
  resourceId: string,
): Uint8Array {
  return createHash("sha256").update(JSON.stringify({ provider, resourceKind, resourceId })).digest();
}
