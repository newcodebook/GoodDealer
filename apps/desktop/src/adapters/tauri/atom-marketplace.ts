import { invoke } from "@tauri-apps/api/core";
import { parseAtomMarketplaceStatus, atomMarketplaceIntentSchema, type AtomMarketplacePort } from "@gooddealer/client-core";
import {
  atomStandardDelistApproveRequestSchema, atomStandardDelistPreviewRequestSchema,
  atomStandardDelistStatusRequestSchema, parseAtomStandardDelistApproval,
  parseAtomStandardDelistPreview, parseAtomStandardDelistStatus, type AtomStandardDelistPort,
} from "@gooddealer/client-core";

export function createAtomMarketplacePort(): AtomMarketplacePort {
  return {
    async status() {
      return parseAtomMarketplaceStatus(await invoke("atom_marketplace_status"));
    },
    async submit(intent) {
      const parsed = atomMarketplaceIntentSchema.safeParse(intent);
      if (!parsed.success) throw new TypeError("invalid Atom seller portfolio intent");
      const wire = new TextEncoder().encode(JSON.stringify(parsed.data));
      await invoke("atom_marketplace_submit", wire);
    },
  };
}

export function createAtomStandardDelistPort(): AtomStandardDelistPort {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  return {
    async preview(intent) {
      const request = atomStandardDelistPreviewRequestSchema.parse(intent);
      const preview = parseAtomStandardDelistPreview(await invoke("atom_standard_delist_preview", bytes(request)));
      const targets = new Set(request.domains);
      if (preview.connectionId !== request.connectionId || preview.domains.length !== targets.size
        || preview.domains.some(domain => !targets.has(domain))) throw new TypeError("Atom preview does not match request");
      return preview;
    },
    async approve(intent) {
      return parseAtomStandardDelistApproval(await invoke("atom_standard_delist_approve",
        bytes(atomStandardDelistApproveRequestSchema.parse(intent))));
    },
    async status(intent) {
      const request = atomStandardDelistStatusRequestSchema.parse(intent);
      const status = parseAtomStandardDelistStatus(await invoke("atom_standard_delist_status", bytes(request)));
      if (request.planId !== null && status.plan?.planId !== request.planId) throw new TypeError("Atom status does not match request");
      return status;
    },
  };
}
