import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

describe("middleware", () => {
  it("retorna 401 para uma rota protegida sem cookie de sessão", () => {
    const request = new NextRequest("http://localhost:3000/api/me");
    const response = middleware(request);
    expect(response.status).toBe(401);
  });

  it("deixa passar (NextResponse.next()) quando o cookie de sessão está presente", () => {
    const request = new NextRequest("http://localhost:3000/api/me", {
      headers: { cookie: "better-auth.session_token=fake-token" },
    });
    const response = middleware(request);
    expect(response.status).not.toBe(401);
  });
});
