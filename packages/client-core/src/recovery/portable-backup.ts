import { z } from "zod";
import { canonicalDomainNameSchema } from "../portfolio/domain-name";

const locale = z.enum(["zh-CN", "en-US"]);
const viewId = z.string().regex(/^portable-[a-f0-9]{32}$/u);

export const portableBackupIntentSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("open"), locale }),
  z.strictObject({ action: z.literal("create"), locale }),
  z.strictObject({ action: z.literal("page"), viewId, after: canonicalDomainNameSchema }),
  z.strictObject({ action: z.literal("export"), viewId, locale }),
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
const portableBackupResultSchema = z.union([
  opened,
  z.strictObject({
    state: z.enum(["cancelled", "closed", "backup_saved", "material_saved", "export_saved", "publication_unknown"]),
  }),
]);
export type PortableBackupResult = z.infer<typeof portableBackupResultSchema>;
export type PortableBackupPage = z.infer<typeof opened>;

export function parsePortableBackupResult(input: unknown): PortableBackupResult {
  return portableBackupResultSchema.parse(input);
}
