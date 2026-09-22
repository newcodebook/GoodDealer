import { z } from "zod";

import { domainAssetIdSchema } from "../workspace/domain-asset-fields";
import { canonicalUtcTimestamp, identifier } from "../wire/index";

/** Coverage is a reviewed product inventory, never an executable Provider permission. */
export const DOMAIN_PROVIDER_CAPABILITY_CATALOG_VERSION = 1 as const;
export const domainProviderCapabilityCatalog = Object.freeze([
  { id: "connection.manage", resource: "connection", effect: "local", admission: "host_only" },
  { id: "zone.observe", resource: "zone", effect: "read", admission: "local_implementation" },
  { id: "dns.records.observe", resource: "dns_record", effect: "read", admission: "local_implementation" },
  { id: "dns.records.manage", resource: "dns_record", effect: "write", admission: "not_executable" },
  { id: "dnssec.manage", resource: "dnssec", effect: "write", admission: "not_executable" },
  { id: "nameservers.manage", resource: "nameservers", effect: "write", admission: "not_executable" },
  { id: "registrar.domain.observe", resource: "registration", effect: "read", admission: "not_executable" },
  { id: "registrar.register", resource: "registration", effect: "financial", admission: "not_executable" },
  { id: "registrar.renew", resource: "registration", effect: "financial", admission: "not_executable" },
  { id: "registrar.transfer.in", resource: "registration", effect: "financial", admission: "not_executable" },
  { id: "registrar.transfer.out", resource: "registration", effect: "financial", admission: "not_executable" },
  { id: "registrar.lock.manage", resource: "registration", effect: "write", admission: "not_executable" },
  { id: "registrar.contact.manage", resource: "registration", effect: "write", admission: "not_executable" },
  { id: "registrar.privacy.manage", resource: "registration", effect: "write", admission: "not_executable" },
  { id: "registrar.auth-code.request", resource: "registration", effect: "write", admission: "not_executable" },
  { id: "domain.monitor", resource: "domain_asset", effect: "read", admission: "not_executable" },
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

export type DomainProviderCapabilityId = z.infer<typeof domainProviderCapabilityIdSchema>;
export type DomainProviderFinancialQuote = z.infer<typeof domainProviderFinancialQuoteSchema>;
export type DomainProviderFinancialConfirmation = z.infer<typeof domainProviderFinancialConfirmationSchema>;
export type DomainProviderHandoffReturn = z.infer<typeof domainProviderHandoffReturnSchema>;
