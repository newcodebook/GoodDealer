import { z } from "zod";

export const identifier = z.string().min(1).max(160).regex(/^[\x21-\x7E]+$/);
export const base64Url = z.string().regex(/^[A-Za-z0-9_-]+$/);
export const safeUnsignedInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const safePositiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const canonicalUtcTimestamp = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/)
  .refine((value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value.replace(/Z$/, ".000Z");
  }, "timestamp must be a real canonical UTC second");

/** Human-authored label. Bounded, no control characters, never an identifier
 * and never used as a lookup key, log key, or path segment. */
export const displayLabel = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "display labels reject control characters")
  .refine((value) => value.trim() === value, "display labels reject leading or trailing whitespace");
