import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "@/db/schema";

const isLocal = env.DATABASE_URL.includes("localhost");

// ssl: local/CI Postgres runs without TLS; a managed cloud Postgres (e.g.
// Supabase) requires it.
// prepare: false — required when connecting through Supabase's transaction
// pooler (PgBouncer in transaction mode), which does not support prepared
// statements; each pooled connection can serve a different backend session,
// so a statement prepared on one may not exist on the next. Harmless to also
// disable locally. max: 1 keeps each serverless function instance (Vercel)
// from opening its own multi-connection pool on top of the pooler's own.
const client = postgres(env.DATABASE_URL, {
  ssl: isLocal ? false : "require",
  prepare: false,
  max: isLocal ? 10 : 1,
});

export const db = drizzle(client, { schema });
export type Database = typeof db;
