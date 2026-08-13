import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";
import { GET } from "@/app/api/me/route";

describe("GET /api/me", () => {
  it("retorna 401 quando não há cookie de sessão", async () => {
    const request = new Request("http://localhost:3000/api/me");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("retorna 200 com os dados do usuário quando a sessão é válida", async () => {
    const email = `aluno-${Date.now()}@example.com`;
    await auth.api.signUpEmail({
      body: { email, password: "senha-segura-123", name: "Aluno Teste" },
    });
    const signIn = await auth.api.signInEmail({
      body: { email, password: "senha-segura-123" },
      asResponse: true,
    });
    const setCookie = signIn.headers.get("set-cookie") ?? "";

    const request = new Request("http://localhost:3000/api/me", {
      headers: { cookie: setCookie },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.email).toBe(email);
  });
});
