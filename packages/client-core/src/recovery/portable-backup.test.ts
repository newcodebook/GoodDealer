import { expect, it } from "vitest";

import { parsePortableBackupResult, portableBackupIntentSchema } from "./portable-backup";

it("uses a bounded import intent and rejects response counts or fields outside the preview", () => {
  const planId = "portable-import-0123456789abcdef0123456789abcdef";
  const apply = { action: "apply_import", planId };
  expect(portableBackupIntentSchema.parse(apply)).toEqual(apply);
  expect(portableBackupIntentSchema.safeParse({ ...apply, entityId: "extra.example" }).success).toBe(false);
  expect(portableBackupIntentSchema.safeParse({ ...apply, planId: planId.replace("-import", "") }).success).toBe(false);

  const preview = {
    state: "import_preview",
    planId,
    additions: 1,
    total: 1,
    next: null,
    rows: [{ entityId: "approved.example", disposition: "add" }],
  };
  expect(parsePortableBackupResult(preview)).toEqual(preview);
  expect(() => parsePortableBackupResult({ ...preview, additions: 0 })).toThrow();
  expect(() => parsePortableBackupResult({ ...preview, next: "approved.example" })).toThrow();
  expect(() => parsePortableBackupResult({ ...preview, recoveryMaterial: "native-only" })).toThrow();
});
