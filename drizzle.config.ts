import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

// Loads .env.local directly (not via lib/env.ts): ES module imports are
// hoisted above this call, so importing the Zod-validated `env` here would
// read process.env before dotenv had a chance to populate it from
// .env.local, breaking the bare `npx drizzle-kit ...` CLI locally. In CI,
// DATABASE_URL is already set as a real environment variable, so this
// dotenv call is a harmless no-op there.
dotenv.config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não definida (verifique .env.local)");
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
