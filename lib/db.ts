import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "@/db/schema";

// ssl: derived from the connection string — local/CI Postgres (localhost)
// runs without TLS, while a managed cloud Postgres (e.g. Supabase in
// production) requires TLS, so we require it for any non-localhost host.
const client = postgres(env.DATABASE_URL, {
  ssl: env.DATABASE_URL.includes("localhost") ? false : "require",
});

export const db = drizzle(client, { schema });
export type Database = typeof db;
