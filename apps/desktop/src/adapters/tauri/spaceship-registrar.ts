import { invoke } from "@tauri-apps/api/core";
import { parseSpaceshipRegistrarStatus, spaceshipRegistrarIntentSchema, type SpaceshipRegistrarPort } from "@gooddealer/client-core";

export function createSpaceshipRegistrarPort(): SpaceshipRegistrarPort {
  return {
    async status() {
      return parseSpaceshipRegistrarStatus(await invoke("spaceship_registrar_status"));
    },
    async submit(intent) {
      const parsed = spaceshipRegistrarIntentSchema.safeParse(intent);
      if (!parsed.success) throw new TypeError("invalid Spaceship registrar intent");
      const wire = new TextEncoder().encode(JSON.stringify(parsed.data));
      await invoke("spaceship_registrar_submit", wire);
    },
  };
}
