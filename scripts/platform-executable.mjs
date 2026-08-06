import { platform } from "node:os";

export function platformExecutable(binary, currentPlatform = platform()) {
  return currentPlatform === "win32" ? `${binary}.cmd` : binary;
}
