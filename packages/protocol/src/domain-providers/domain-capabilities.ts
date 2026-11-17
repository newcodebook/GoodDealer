import { z } from "zod";

import { domainAssetIdSchema } from "../workspace/domain-asset-fields";
import { canonicalUtcTimestamp, identifier } from "../wire/index";

/**
 * Coverage is a reviewed product inventory, never an executable Provider permission. Version 2
 * (ADR-0027) gives every Provider capability one of the four platform roles and covers the
 * registrar, DNS, marketplace and acquisition capabilities of section 2, with each role's
 * monitoring. `connection.manage` is the Host's local credential management and has no role.
 * Whether a capability can run on a platform is the per-platform manifest's and the Host
 * qualification register's answer, never this catalog's.
 */
export const DOMAIN_PROVIDER_CAPABILITY_CATALOG_VERSION = 2 as const;

/** Freezes the catalog and each entry: the financial-quote check reads `effect` from them. */
function deepFreeze<T extends readonly object[]>(entries: T): T {
  for (const entry of entries) Object.freeze(entry);
  return Object.freeze(entries);
}
export const domainProviderRoles = ["registrar", "dns", "marketplace", "acquisition"] as const;
export const domainProviderCapabilityCatalog = deepFreeze([
  { id: "connection.manage", role: null, resource: "connection", effect: "local" },
  { id: "registrar.domain.observe", role: "registrar", resource: "registration", effect: "read" },
  { id: "registrar.register", role: "registrar", resource: "registration", effect: "financial" },
  { id: "registrar.renew", role: "registrar", resource: "registration", effect: "financial" },
  { id: "registrar.restore", role: "registrar", resource: "registration", effect: "financial" },
  { id: "registrar.transfer.in", role: "registrar", resource: "registration", effect: "financial" },
  { id: "registrar.transfer.out", role: "registrar", resource: "registration", effect: "financial" },
  { id: "registrar.auth-code.request", role: "registrar", resource: "registration", effect: "write" },
  { id: "registrar.lock.manage", role: "registrar", resource: "registration", effect: "write" },
  // Turning auto-renew on authorises future charges, and ADR-0024 lets no standing authorisation
  // replace a confirmed charge, so changing it is confirmed like one.
  { id: "registrar.auto-renew.manage", role: "registrar", resource: "registration", effect: "financial" },
  { id: "registrar.contact.manage", role: "registrar", resource: "registration", effect: "write" },
  { id: "registrar.privacy.manage", role: "registrar", resource: "registration", effect: "write" },
  { id: "nameservers.manage", role: "registrar", resource: "nameservers", effect: "write" },
  { id: "registrar.glue.manage", role: "registrar", resource: "nameservers", effect: "write" },
  { id: "registrar.monitor", role: "registrar", resource: "registration", effect: "read" },
  { id: "zone.observe", role: "dns", resource: "zone", effect: "read" },
  { id: "dns.records.observe", role: "dns", resource: "dns_record", effect: "read" },
  { id: "dns.records.manage", role: "dns", resource: "dns_record", effect: "write" },
  { id: "dnssec.manage", role: "dns", resource: "dnssec", effect: "write" },
  { id: "dns.monitor", role: "dns", resource: "zone", effect: "read" },
  { id: "marketplace.listing.observe", role: "marketplace", resource: "listing", effect: "read" },
  { id: "marketplace.listing.manage", role: "marketplace", resource: "listing", effect: "write" },
  { id: "marketplace.price.manage", role: "marketplace", resource: "listing", effect: "write" },
  { id: "marketplace.sales.observe", role: "marketplace", resource: "sale", effect: "read" },
  { id: "marketplace.sale.auth-code.deliver", role: "marketplace", resource: "sale", effect: "write" },
  { id: "marketplace.ownership.verify", role: "marketplace", resource: "listing", effect: "write" },
  { id: "marketplace.monitor", role: "marketplace", resource: "listing", effect: "read" },
  { id: "acquisition.search", role: "acquisition", resource: "offer", effect: "read" },
  { id: "acquisition.offer.observe", role: "acquisition", resource: "offer", effect: "read" },
  { id: "acquisition.bid", role: "acquisition", resource: "auction", effect: "financial" },
  { id: "acquisition.backorder", role: "acquisition", resource: "backorder", effect: "financial" },
  { id: "acquisition.purchase", role: "acquisition", resource: "offer", effect: "financial" },
  { id: "acquisition.arrival.reconcile", role: "acquisition", resource: "registration", effect: "read" },
  { id: "acquisition.monitor", role: "acquisition", resource: "auction", effect: "read" },
] as const);

export const domainProviderCapabilityIdSchema = z.enum(
  domainProviderCapabilityCatalog.map((capability) => capability.id) as [
    (typeof domainProviderCapabilityCatalog)[number]["id"],
    ...(typeof domainProviderCapabilityCatalog)[number]["id"][],
  ],
);

export const DOMAIN_PROVIDER_OPERATION_SCHEMA_VERSION = 1 as const;
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

const financialQuoteFields = {
  schemaVersion: z.literal(DOMAIN_PROVIDER_OPERATION_SCHEMA_VERSION),
  planId: identifier,
  itemId: identifier,
  entityId: domainAssetIdSchema,
  capabilityId: domainProviderCapabilityIdSchema,
  planHash: digestSchema,
  // Opaque Host-local binding and terms fingerprints; Provider resource IDs never cross IPC.
  resourceBindingDigest: digestSchema,
  termsDigest: digestSchema,
  termsSummary: z.string().min(1).max(500)
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "terms summary rejects control characters"),
  quoteDigest: digestSchema,
  currency: z.string().regex(/^[A-Z]{3}$/u),
  totalAmount: z.string().regex(/^(?:0|[1-9]\d{0,11})\.\d{2}$/u),
  expiresAt: canonicalUtcTimestamp,
  confirmationNonce: identifier,
} as const;

/** A Host-issued quote is bound to one plan item. It is not a payment credential or an execution permit. */
export const domainProviderFinancialQuoteSchema = z.object(financialQuoteFields).strict().superRefine((quote, context) => {
  if (!domainProviderCapabilityCatalog.some((capability) =>
    capability.id === quote.capabilityId && capability.effect === "financial")) {
    context.addIssue({ code: "custom", path: ["capabilityId"], message: "financial quote requires a financial capability" });
  }
});

/** Renderer echoes only Host-issued references; Host must re-read the quote and consume the nonce once. */
export const domainProviderFinancialConfirmationSchema = z.object({
  schemaVersion: financialQuoteFields.schemaVersion,
  planId: financialQuoteFields.planId,
  itemId: financialQuoteFields.itemId,
  planHash: financialQuoteFields.planHash,
  quoteDigest: financialQuoteFields.quoteDigest,
  confirmationNonce: financialQuoteFields.confirmationNonce,
}).strict();

/** Returning from a Provider page is an untrusted hint, never a success or payment receipt. */
export const domainProviderHandoffReturnSchema = z.object({
  schemaVersion: z.literal(DOMAIN_PROVIDER_OPERATION_SCHEMA_VERSION),
  operationId: identifier,
  returnNonce: identifier,
}).strict();

export const domainProviderRoleSchema = z.enum(domainProviderRoles);

export type DomainProviderRole = z.infer<typeof domainProviderRoleSchema>;
export type DomainProviderCapabilityId = z.infer<typeof domainProviderCapabilityIdSchema>;
export type DomainProviderFinancialQuote = z.infer<typeof domainProviderFinancialQuoteSchema>;
export type DomainProviderFinancialConfirmation = z.infer<typeof domainProviderFinancialConfirmationSchema>;
export type DomainProviderHandoffReturn = z.infer<typeof domainProviderHandoffReturnSchema>;
