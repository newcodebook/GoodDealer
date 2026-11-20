import { z } from "zod";
import { canonicalDomainNameSchema } from "../portfolio/domain-name";

const locale = z.enum(["zh-CN", "en-US"]);
const viewId = z.string().regex(/^portable-[a-f0-9]{32}$/u);
const planId = z.string().regex(/^portable-import-[a-f0-9]{32}$/u);

export const portableBackupIntentSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("open"), locale }),
  z.strictObject({ action: z.literal("create"), locale }),
  z.strictObject({ action: z.literal("page"), viewId, after: canonicalDomainNameSchema }),
  z.strictObject({ action: z.literal("export"), viewId, locale }),
  z.strictObject({ action: z.literal("preview_import"), viewId }),
  z.strictObject({ action: z.literal("import_page"), planId, after: canonicalDomainNameSchema }),
  z.strictObject({ action: z.literal("apply_import"), planId }),
  z.strictObject({ action: z.literal("cancel_import"), planId }),
  z.strictObject({ action: z.literal("close"), viewId }),
]);
export type PortableBackupIntent = z.infer<typeof portableBackupIntentSchema>;

const asset = z.strictObject({
  entityId: canonicalDomainNameSchema,
  note: z.string().max(20_000).nullable(),
  portfolioId: z.string().max(200).nullable(),
  tags: z.array(z.string().max(128)).max(128),
  targetPrice: z.strictObject({
    currency: z.string().regex(/^[A-Z]{3}$/u),
    amount: z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/u).max(40),
  }).nullable(),
});

const opened = z.strictObject({
  state: z.literal("opened"),
  viewId,
  createdAt: z.iso.datetime(),
  rows: z.array(asset).max(50),
  next: canonicalDomainNameSchema.nullable(),
}).refine(({ rows, next }) => (
  rows.every((row, index) => index === 0 || rows[index - 1]!.entityId < row.entityId) &&
  (next === null || (rows.length === 50 && rows.at(-1)?.entityId === next))
));
const importPreview = z.strictObject({
  state: z.literal("import_preview"),
  planId,
  additions: z.number().int().min(0).max(100_000),
  total: z.number().int().min(0).max(100_000),
  next: canonicalDomainNameSchema.nullable(),
  rows: z.array(z.strictObject({
    entityId: canonicalDomainNameSchema,
    disposition: z.enum(["add", "unchanged", "preserve_existing", "blocked_by_asset_history", "missing_portfolio"]),
  })).max(50),
}).refine(({ additions, total, next, rows }) => (
  additions <= total && rows.length <= total &&
  rows.filter((row) => row.disposition === "add").length <= additions &&
  rows.every((row, index) => index === 0 || rows[index - 1]!.entityId < row.entityId) &&
  (next === null || (rows.length === 50 && rows.length < total && rows.at(-1)?.entityId === next))
));
const portableBackupResultSchema = z.union([
  opened,
  importPreview,
  z.strictObject({ state: z.literal("import_applied"), additions: z.number().int().min(1).max(100_000) }),
  z.strictObject({
    state: z.enum(["cancelled", "closed", "backup_saved", "material_saved", "export_saved", "publication_unknown", "import_cancelled"]),
  }),
]);
export type PortableBackupResult = z.infer<typeof portableBackupResultSchema>;
export type PortableBackupPage = z.infer<typeof opened>;
export type PortableBackupImportPreview = z.infer<typeof importPreview>;

export function parsePortableBackupResult(input: unknown): PortableBackupResult {
  return portableBackupResultSchema.parse(input);
}
