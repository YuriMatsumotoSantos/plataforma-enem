import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { REDACAO_ENABLED, PLANOS_ENABLED } from "@/lib/feature-flags";

// NOTE: getSessionCookie only checks that a session cookie is *present*,
// it does not validate the session (signature, expiry, revocation). This is
// an outer, fail-fast defense layer only; full validation happens
// server-side in each route (e.g. app/api/me/route.ts via auth.api.getSession).
// This now also covers /admin, /pratica, /simulados, and /redacao page routes
// (e.g. app/admin/revisao/page.tsx): the middleware only checks for cookie
// presence there too, the role: admin check still happens server-side in
// requireAdmin inside the /api/admin/* routes those pages consume.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Feature flags (lib/feature-flags.ts): redirect away entirely, before any
  // auth check, regardless of session state. Flip the flag there to bring a
  // feature back — nothing else in this file needs to change.
  if (pathname.startsWith("/redacao") && !REDACAO_ENABLED) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (pathname.startsWith("/planos") && !PLANOS_ENABLED) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Public routes are excluded here (exact path checks) rather than in the
  // matcher regex below: a matcher-level negative lookahead like
  // "((?!health|auth).*)" excludes by *prefix*, not by path segment, so it
  // silently also exempts unrelated future routes such as /api/healthcheck
  // or /api/authenticate. Exact checks here don't have that failure mode.
  //
  // /api/stripe/webhook is deliberately public too: it's an unauthenticated
  // POST from Stripe's own servers, never carrying a Better Auth session
  // cookie — the route's own signature verification
  // (stripe.webhooks.constructEvent) is what actually protects it. Without
  // this exemption every webhook delivery hit this middleware's session
  // check first and got a 401 before the route ever ran; a real bug that
  // shipped in the original merge and was never exercised because no real
  // Stripe webhook has hit production yet.
  //
  // /planos is public on purpose (viewable logged out) when PLANOS_ENABLED
  // — the flag check above already redirected away if it's disabled, so
  // reaching this line means it's enabled and should skip the auth gate.
  if (
    pathname === "/api/health" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/stripe/webhook" ||
    pathname === "/planos"
  ) {
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

// Deny-by-default: match every /api/* route, plus /admin/*, /pratica/*,
// /simulados/*, and /redacao/* page routes. Only the exclusions inside
// middleware() above (exact path checks) are automatic. A new protected
// *route prefix* still needs its own opt-in entry added to the matcher
// array below. /planos is matched too, purely so the feature-flag redirect
// above can intercept it — it is NOT auth-gated (see the exemption above).
export const config = {
  matcher: [
    "/api/:path*",
    "/admin/:path*",
    "/pratica/:path*",
    "/simulados/:path*",
    "/redacao/:path*",
    "/planos",
  ],
};
