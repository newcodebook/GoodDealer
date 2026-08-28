import { z } from "zod";

import { canonicalDomainNameSchema, canonicalizeDomainName } from "./domain-name";

export const csvImportFieldSchema = z.enum(["domain", "registrar", "expiry", "cost", "tags", "nameservers", "ignore"]);

export const csvColumnMappingSchema = z
  .object({ columnIndex: z.number().int().nonnegative(), field: csvImportFieldSchema })
  .strict();

export const csvImportPreviewRowSchema = z.discriminatedUnion("status", [
  z.object({ rowNumber: z.number().int().positive(), rawDomain: z.string(), status: z.literal("new"), canonicalDomain: canonicalDomainNameSchema, registrar: z.string().nullable() }).strict(),
  z.object({ rowNumber: z.number().int().positive(), rawDomain: z.string(), status: z.literal("duplicate"), canonicalDomain: canonicalDomainNameSchema, registrar: z.string().nullable() }).strict(),
  z.object({ rowNumber: z.number().int().positive(), rawDomain: z.string(), status: z.literal("invalid"), reason: z.enum(["empty", "invalid_domain", "malformed_csv"]), registrar: z.string().nullable() }).strict(),
]);

export const csvImportPreviewSchema = z
  .object({
    totalCount: z.number().int().nonnegative(),
    newCount: z.number().int().nonnegative(),
    duplicateCount: z.number().int().nonnegative(),
    invalidCount: z.number().int().nonnegative(),
    rows: z.array(csvImportPreviewRowSchema),
  })
  .strict()
  .superRefine((preview, context) => {
    if (preview.totalCount !== preview.newCount + preview.duplicateCount + preview.invalidCount) {
      context.addIssue({ code: "custom", path: ["totalCount"], message: "preview counts must reconcile" });
    }
    if (preview.rows.length !== preview.totalCount) {
      context.addIssue({ code: "custom", path: ["rows"], message: "preview row count must reconcile" });
    }
  });

const csvImportFileViewSchema = z.object({
  schemaVersion: z.literal(1),
  step: z.literal("file"),
  canEdit: z.literal(true),
  acceptedMediaTypes: z.tuple([z.literal("text/csv")]),
  selectedFile: z.object({ name: z.string().min(1).max(255), sizeBytes: z.number().int().nonnegative(), rowCount: z.number().int().nonnegative(), columnCount: z.number().int().nonnegative() }).strict().nullable(),
}).strict();

const csvImportMapViewSchema = z.object({
  schemaVersion: z.literal(1),
  step: z.literal("map"),
  canEdit: z.literal(true),
  columns: z.array(z.object({ index: z.number().int().nonnegative(), header: z.string().max(256), sample: z.string().max(2048), mapping: csvImportFieldSchema }).strict()).min(1),
  hasDomainMapping: z.boolean(),
}).strict().superRefine((view, context) => {
  const domainMappings = view.columns.filter((column) => column.mapping === "domain").length;
  if (view.hasDomainMapping !== (domainMappings === 1)) {
    context.addIssue({ code: "custom", path: ["hasDomainMapping"], message: "exactly one domain mapping is required" });
  }
});

const csvImportPreviewViewSchema = z.object({
  schemaVersion: z.literal(1),
  step: z.literal("preview"),
  canEdit: z.literal(true),
  preview: csvImportPreviewSchema,
}).strict();

export const csvImportViewModelSchema = z.discriminatedUnion("step", [
  csvImportFileViewSchema,
  csvImportMapViewSchema,
  csvImportPreviewViewSchema,
]);

export type CsvImportField = z.infer<typeof csvImportFieldSchema>;
export type CsvColumnMapping = z.infer<typeof csvColumnMappingSchema>;
export type CsvImportPreviewRow = z.infer<typeof csvImportPreviewRowSchema>;
export type CsvImportPreview = z.infer<typeof csvImportPreviewSchema>;
export type CsvImportViewModel = z.infer<typeof csvImportViewModelSchema>;

export function buildCsvImportPreview(input: {
  readonly csvText: string;
  readonly mappings: readonly CsvColumnMapping[];
  readonly existingDomains: ReadonlySet<string>;
}): CsvImportPreview {
  const mappings = z.array(csvColumnMappingSchema).parse(input.mappings);
  const domainMappings = mappings.filter((mapping) => mapping.field === "domain");
  if (domainMappings.length !== 1) throw new TypeError("CSV requires exactly one domain mapping");
  const mappedFields = mappings.filter((mapping) => mapping.field !== "ignore").map((mapping) => mapping.field);
  if (new Set(mappedFields).size !== mappedFields.length) throw new TypeError("CSV fields cannot be mapped more than once");
  const columnIndexes = mappings.map((mapping) => mapping.columnIndex);
  if (new Set(columnIndexes).size !== columnIndexes.length) throw new TypeError("CSV columns cannot have multiple mappings");
  const domainColumn = domainMappings[0]!.columnIndex;
  const registrarColumn = mappings.find((mapping) => mapping.field === "registrar")?.columnIndex;
  const records = parseCsv(input.csvText);
  if (records.length === 0) throw new TypeError("CSV must include a header row");

  const existing = new Set([...input.existingDomains].map((domain) => canonicalizeDomainName(domain)));
  const accepted = new Set<string>();
  const rows: CsvImportPreviewRow[] = [];
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index]!;
    const rawDomain = record[domainColumn] ?? "";
    const registrar = registrarColumn === undefined ? null : (record[registrarColumn]?.trim() || null);
    if (rawDomain.trim() === "") {
      rows.push({ rowNumber: index + 1, rawDomain, status: "invalid", reason: "empty", registrar });
      continue;
    }
    try {
      const canonicalDomain = canonicalizeDomainName(rawDomain.trim());
      if (existing.has(canonicalDomain) || accepted.has(canonicalDomain)) {
        rows.push({ rowNumber: index + 1, rawDomain, status: "duplicate", canonicalDomain, registrar });
      } else {
        accepted.add(canonicalDomain);
        rows.push({ rowNumber: index + 1, rawDomain, status: "new", canonicalDomain, registrar });
      }
    } catch {
      rows.push({ rowNumber: index + 1, rawDomain, status: "invalid", reason: "invalid_domain", registrar });
    }
  }

  return csvImportPreviewSchema.parse({
    totalCount: rows.length,
    newCount: rows.filter((row) => row.status === "new").length,
    duplicateCount: rows.filter((row) => row.status === "duplicate").length,
    invalidCount: rows.filter((row) => row.status === "invalid").length,
    rows,
  });
}

function parseCsv(text: string): string[][] {
  if (text.length > 20_000_000) throw new TypeError("CSV exceeds the 20 MB parsing limit");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new TypeError("CSV has an unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows;
}
