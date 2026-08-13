import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// NOTE: getSessionCookie only checks that a session cookie is *present* —
// it does not validate the session (signature, expiry, revocation). This is
// an outer, fail-fast defense layer only; full validation happens
// server-side in each route (e.g. app/api/me/route.ts via auth.api.getSession).
export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  return NextResponse.next();
}

// Deny-by-default: match every /api/* route except the public ones
// (/api/health, /api/auth/*), so new protected routes are covered
// automatically instead of requiring an opt-in addition to this list.
export const config = {
  matcher: ["/api/((?!health|auth).*)"],
};
