import { describe, it, expect } from "vitest";
import { getSecurityHeaders } from "@/lib/security-headers";

describe("getSecurityHeaders", () => {
  it("includes a restrictive Content-Security-Policy", () => {
    const headers = getSecurityHeaders();
    const csp = headers.find((h) => h.key === "Content-Security-Policy");
    expect(csp).toBeDefined();
    expect(csp!.value).toContain("default-src 'self'");
  });

  it("includes X-Frame-Options set to DENY", () => {
    const headers = getSecurityHeaders();
    expect(headers).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
  });

  it("includes X-Content-Type-Options set to nosniff", () => {
    const headers = getSecurityHeaders();
    expect(headers).toContainEqual({
      key: "X-Content-Type-Options",
      value: "nosniff",
    });
  });

  it("includes Strict-Transport-Security", () => {
    const headers = getSecurityHeaders();
    const hsts = headers.find((h) => h.key === "Strict-Transport-Security");
    expect(hsts).toBeDefined();
    expect(hsts!.value).toContain("max-age=");
  });
});
