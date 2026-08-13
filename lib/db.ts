import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";

// ssl: false — local/CI Postgres runs without TLS; a managed cloud Postgres
// (e.g. Supabase in production) requires this to be removed or set to true.
const client = postgres(env.DATABASE_URL, {
  ssl: false,
});

export const db = drizzle(client);
export type Database = typeof db;
