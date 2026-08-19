import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// NOTE: getSessionCookie only checks that a session cookie is *present* —
// it does not validate the session (signature, expiry, revocation). This is
// an outer, fail-fast defense layer only; full validation happens
// server-side in each route (e.g. app/api/me/route.ts via auth.api.getSession).
// This now also covers /admin page routes (e.g. app/admin/revisao/page.tsx):
// the middleware only checks for cookie presence there too, the role: admin
// check still happens server-side in requireAdmin inside the /api/admin/*
// routes those pages consume.
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
    // API routes get a JSON 401 (correct for fetch/XHR callers). Page routes
    // get redirected to "/" — there's no dedicated /login page yet (MVP),
    // so "/" is the placeholder destination until one exists.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

// Deny-by-default: match every /api/* route, plus /admin/* page routes.
// Public routes are exempted inside middleware() above (exact path checks),
// not here, so new protected routes are covered automatically instead of
// requiring an opt-in addition.
export const config = {
  matcher: ["/api/:path*", "/admin/:path*", "/pratica/:path*", "/simulados/:path*"],
};
