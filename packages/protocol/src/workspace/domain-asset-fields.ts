import { z } from "zod";

const utf8Encoder = new TextEncoder();

/** Portable byte ordering shared by canonical workspace arrays. */
export function compareUtf8(left: string, right: string): number {
  const leftBytes = utf8Encoder.encode(left);
  const rightBytes = utf8Encoder.encode(right);
  const sharedLength = Math.min(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index]! - rightBytes[index]!;
  }
  return leftBytes.byteLength - rightBytes.byteLength;
}

export const domainAssetNoteSchema = z
  .string()
  .max(10_000)
  .refine(
    (value) => !/[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value),
    "notes reject format and non-text control characters",
  );

export const domainAssetTagSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "tags reject control characters")
  .refine((value) => value.trim() === value, "tags reject leading or trailing whitespace");

export const domainAssetTagsSchema = z
  .array(domainAssetTagSchema)
  .max(128)
  .superRefine((tags, context) => {
    for (let index = 1; index < tags.length; index += 1) {
      if (compareUtf8(tags[index - 1]!, tags[index]!) >= 0) {
        context.addIssue({
          code: "custom",
          path: [],
          message: "tags must be unique and strictly ascending",
        });
        break;
      }
    }
  });

export const canonicalMoneySchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount: z.string().regex(/^(0|[1-9]\d{0,15})(\.\d{0,7}[1-9])?$/),
  })
  .strict();
