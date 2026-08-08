import { platform } from "node:os";

export function platformCommand(
  binary,
  args,
  currentPlatform = platform(),
  commandInterpreter = process.env.ComSpec ?? "cmd.exe",
) {
  if (currentPlatform === "win32") {
    return {
      binary: commandInterpreter,
      args: ["/d", "/s", "/c", binary, ...args],
    };
  }

  return { binary, args };
}
