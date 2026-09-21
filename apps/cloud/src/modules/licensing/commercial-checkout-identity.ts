import { createHash } from "node:crypto";

import type { ResolvedCommercialCheckout } from "./commercial-checkout";

/** Canonical identity for one immutable Provider checkout operation. */
export function commercialCheckoutRequestDigest(definition: ResolvedCommercialCheckout): Uint8Array {
  return createHash("sha256").update(JSON.stringify({
    provider: definition.provider,
    offer: definition.offer,
    campaignCode: definition.campaignCode,
    providerItemId: definition.providerItemId,
    providerDiscountId: definition.providerDiscountId,
    currency: definition.currency,
    amountMinor: definition.amountMinor,
  })).digest();
}
