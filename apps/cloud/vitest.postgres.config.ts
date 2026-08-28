import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/postgres/**/*.test.ts"],
    fileParallelism: false,
  },
});
