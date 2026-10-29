import type { CanonicalMoneyView } from "@gooddealer/client-core";

import { parseTargetPriceInput } from "../../portfolio";

/** The selected assets a batch edit dialog plans against. */
export interface BatchEditTarget {
  readonly id: string;
  readonly domain: string;
  readonly targetPrice: CanonicalMoneyView | null;
}

export type BatchPriceRule =
  | { readonly mode: "uniform"; readonly amount: string }
  | { readonly mode: "percent"; readonly direction: "decrease" | "increase"; readonly percent: number }
  | { readonly mode: "each"; readonly amounts: Readonly<Record<string, string>> };

export type NameserverTarget = "marketplace" | "cloudflare" | "registrar";

export type NameserverChange =
  | { readonly mode: "platform"; readonly target: NameserverTarget }
  | { readonly mode: "custom"; readonly nameservers: readonly string[] };

export const dnsRecordTypes = ["A", "AAAA", "CNAME", "TXT", "MX"] as const;
export type DnsRecordType = (typeof dnsRecordTypes)[number];
export const dnsRecordTtls = ["Auto", "300", "3600", "86400"] as const;
export type DnsRecordTtl = (typeof dnsRecordTtls)[number];

export interface DnsRecordChange {
  readonly type: DnsRecordType;
  readonly host: string;
  readonly value: string;
  readonly ttl: DnsRecordTtl;
}

export interface ListingChange {
  readonly platforms: readonly string[];
  /** Canonical amount, or null to keep each domain's current BIN. */
  readonly price: string | null;
}

/** Applies a price rule to one target; null keeps the target unpriced. Percent results round to cents. */
export function applyPriceRule(target: BatchEditTarget, rule: BatchPriceRule): string | null {
  if (rule.mode === "uniform") return rule.amount;
  if (rule.mode === "each") return rule.amounts[target.id] ?? target.targetPrice?.amount ?? null;
  if (target.targetPrice === null) return null;
  const factor = rule.direction === "decrease" ? 1 - rule.percent / 100 : 1 + rule.percent / 100;
  const cents = Math.max(0, Math.round(Number(target.targetPrice.amount) * factor * 100));
  return parseTargetPriceInput((cents / 100).toFixed(2));
}

/** Percent adjustments stay within 0–90 % so a typo cannot zero out a portfolio. */
export function parsePercentInput(input: string): number | null {
  const normalized = input.trim().replace(/%$/u, "");
  if (!/^\d{1,2}(?:\.\d)?$/u.test(normalized)) return null;
  const value = Number(normalized);
  return value > 0 && value <= 90 ? value : null;
}

const hostLabel = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/u;

/** A fully qualified Nameserver host such as ns1.example.com. */
export function isNameserverHost(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/\.$/u, "");
  const labels = host.split(".");
  return host.length <= 253 && labels.length >= 2 && labels.every((label) => hostLabel.test(label));
}

/** A record host is "@" or one or more relative labels such as "www" or "_atomverify". */
export function isRecordHost(value: string): boolean {
  const host = value.trim().toLowerCase();
  if (host === "@") return true;
  return host.length <= 253 && host.split(".").every((label) => /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/u.test(label));
}

/** Records that change where traffic or mail goes need the "caution" tier; TXT does not. */
export function recordRoutingImpact(type: DnsRecordType): "mail" | "routing" | null {
  if (type === "MX") return "mail";
  return type === "TXT" ? null : "routing";
}
