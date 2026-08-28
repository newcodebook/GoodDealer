import { z } from "zod";

const asciiDomainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export const canonicalDomainNameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(asciiDomainPattern, "domain name must be canonical ASCII with valid labels");

export type CanonicalDomainName = z.infer<typeof canonicalDomainNameSchema>;

/**
 * Converts user-entered Unicode domain names to the browser URL implementation's IDNA ASCII
 * form. The returned value is identity-only: paths, credentials, ports, IP literals, and
 * malformed labels are rejected instead of being silently discarded.
 */
export function canonicalizeDomainName(input: unknown): CanonicalDomainName {
  if (typeof input !== "string" || input.length === 0 || input !== input.trim()) {
    throw new TypeError("domain name must be a non-empty trimmed string");
  }

  const withoutScheme = input.replace(/^https?:\/\//iu, "");
  if (
    withoutScheme.length === 0
    || /[\s/@?#]/u.test(withoutScheme)
    || withoutScheme.includes(":")
    || withoutScheme.startsWith(".")
    || withoutScheme.endsWith(".")
  ) {
    throw new TypeError("domain name contains non-identity URL data");
  }

  let hostname: string;
  try {
    hostname = new URL(`http://${withoutScheme}`).hostname.toLowerCase();
  } catch {
    throw new TypeError("domain name is invalid");
  }

  if (!/[a-z]/u.test(hostname.split(".").at(-1) ?? "")) {
    throw new TypeError("domain name requires a non-numeric public suffix");
  }

  return canonicalDomainNameSchema.parse(hostname);
}
