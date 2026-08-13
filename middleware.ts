import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// NOTE: getSessionCookie only checks that a session cookie is *present* —
// it does not validate the session (signature, expiry, revocation). This is
// an outer, fail-fast defense layer only; full validation happens
// server-side in each route (e.g. app/api/me/route.ts via auth.api.getSession).
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes are excluded here (exact path checks) rather than in the
  // matcher regex below: a matcher-level negative lookahead like
  // "((?!health|auth).*)" excludes by *prefix*, not by path segment, so it
  // silently also exempts unrelated future routes such as /api/healthcheck
  // or /api/authenticate. Exact checks here don't have that failure mode.
  if (pathname === "/api/health" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  return NextResponse.next();
}

// Deny-by-default: match every /api/* route. Public routes are exempted
// inside middleware() above (exact path checks), not here, so new protected
// routes are covered automatically instead of requiring an opt-in addition.
export const config = {
  matcher: ["/api/:path*"],
};
