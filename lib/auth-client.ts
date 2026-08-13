import { createAuthClient } from "better-auth/react";

// NOTE: reference process.env.NEXT_PUBLIC_APP_URL directly (not via `env` from
// "@/lib/env") — this file runs in the browser, and Next.js only inlines
// `process.env.X` member-expression lookups into client bundles. Passing the
// whole `process.env` object into `parseEnv()` (as lib/env.ts does) is NOT
// inlined, so in the browser `process.env` is an empty shim and `parseEnv`
// would throw at import time on every required var.
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
});
