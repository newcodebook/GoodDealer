import { z } from "zod";

import { encodeDomainSeparatedWireValue, identifier } from "../wire/index";
import {
  canonicalMoneySchema,
  compareUtf8,
  domainAssetNoteSchema,
  domainAssetTagsSchema,
} from "./domain-asset-fields";
import type { WorkspaceEntityDigest } from "./sync-mutation";

const DOMAIN_ASSET_DIGEST_DOMAIN = "GOODDEALER-WORKSPACE-DOMAIN-ASSET-V1";

export const domainAssetProjectionRowSchema = z
  .object({
    entityId: identifier,
    note: domainAssetNoteSchema.nullable(),
    portfolioId: identifier.nullable(),
    tags: domainAssetTagsSchema,
    targetPrice: canonicalMoneySchema.nullable(),
  })
  .strict();

export const domainAssetProjectionSchema = z
  .array(domainAssetProjectionRowSchema)
  .superRefine((rows, context) => {
    for (let index = 1; index < rows.length; index += 1) {
      if (compareUtf8(rows[index - 1]!.entityId, rows[index]!.entityId) >= 0) {
        context.addIssue({
          code: "custom",
          path: [index, "entityId"],
          message: "domain assets must be unique and strictly ascending by UTF-8 bytes",
        });
        break;
      }
    }
  });

export function encodeDomainAssetProjectionDigestInput(rows: unknown): Uint8Array {
  const parsed = domainAssetProjectionSchema.parse(rows);
  return encodeDomainSeparatedWireValue(DOMAIN_ASSET_DIGEST_DOMAIN, parsed);
}

export async function computeDomainAssetEntityDigests(
  rows: readonly DomainAssetProjectionRow[],
  sha256: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<readonly WorkspaceEntityDigest[]> {
  const digest = await sha256(encodeDomainAssetProjectionDigestInput(rows));
  if (digest.byteLength !== 32) throw new TypeError("SHA-256 digest must be exactly 32 bytes");
  return [{
    entityType: "domain_asset",
    partitionId: null,
    digest: encodeBase64Url(digest),
  }];
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export interface DomainAssetProjectionRow {
  readonly entityId: string;
  readonly note: string | null;
  readonly portfolioId: string | null;
  readonly tags: readonly string[];
  readonly targetPrice: { readonly currency: string; readonly amount: string } | null;
}
