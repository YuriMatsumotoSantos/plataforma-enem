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
    expect(response.status).toBe(200);
  });

  it("deixa /api/health passar sem cookie de sessão", () => {
    const request = new NextRequest("http://localhost:3000/api/health");
    const response = middleware(request);
    expect(response.status).toBe(200);
  });

  it("deixa /api/auth/* passar sem cookie de sessão", () => {
    const request = new NextRequest(
      "http://localhost:3000/api/auth/sign-in/email"
    );
    const response = middleware(request);
    expect(response.status).toBe(200);
  });

  it("não trata /api/healthcheck ou /api/authenticate como públicas (exclusão é por caminho exato, não prefixo)", () => {
    const healthcheck = middleware(
      new NextRequest("http://localhost:3000/api/healthcheck")
    );
    expect(healthcheck.status).toBe(401);

    const authenticate = middleware(
      new NextRequest("http://localhost:3000/api/authenticate")
    );
    expect(authenticate.status).toBe(401);
  });

  it("redireciona /admin/revisao para / quando não há cookie de sessão", () => {
    const request = new NextRequest("http://localhost:3000/admin/revisao");
    const response = middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("deixa /admin/revisao passar quando o cookie de sessão está presente", () => {
    const request = new NextRequest("http://localhost:3000/admin/revisao", {
      headers: { cookie: "better-auth.session_token=fake-token" },
    });
    const response = middleware(request);
    expect(response.status).toBe(200);
  });
});
