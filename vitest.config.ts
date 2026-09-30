import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the pure lib/ modules (the e2e suite lives in e2e/).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["lib/**/*.test.ts"], environment: "node" },
});
