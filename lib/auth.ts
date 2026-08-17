import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import * as schema from "@/db/schema";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  // Better Auth derives the cookie `Secure` flag from BETTER_AUTH_URL's
  // protocol first, falling back to NODE_ENV only when indeterminate. This
  // guard makes the intent explicit and prevents an accidental
  // `http://` BETTER_AUTH_URL in production from silently disabling `Secure`.
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  // cookieCache trusts the signed session cookie for up to 5 minutes without
  // a DB round-trip, so a revoked/signed-out session can still validate for
  // up to 5 minutes after revocation. Fine for /api/me; future code gating
  // paid access or bans should pass `disableCookieCache: true` to that
  // specific auth.api.getSession() call.
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "aluno",
        input: false,
      },
    },
  },
});
