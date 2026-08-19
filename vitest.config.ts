import { defineConfig } from "vitest/config";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

export default defineConfig({
  test: {
    environment: "node",
    // Every test file shares one local Postgres with no per-test
    // transaction rollback. Running files in parallel (vitest's default)
    // lets concurrent inserts race: unique-constraint collisions on
    // random test years, and aggregate-count tests reading a mid-insert
    // snapshot from another file. Confirmed by reproducing with
    // --no-file-parallelism, which eliminated the flakiness.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
