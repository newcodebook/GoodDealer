import { invoke } from "@tauri-apps/api/core";
import { parseAtomMarketplaceStatus, atomMarketplaceIntentSchema, type AtomMarketplacePort } from "@gooddealer/client-core";

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
