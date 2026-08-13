import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";

describe("autenticação por e-mail e senha", () => {
  it("permite cadastro com e-mail e senha válidos", async () => {
    const result = await auth.api.signUpEmail({
      body: {
        email: `aluno-${Date.now()}@example.com`,
        password: "senha-segura-123",
        name: "Aluno Teste",
      },
    });
    expect(result.user).toBeDefined();
    expect(result.user.email).toContain("@example.com");
  });

  it("permite login com credenciais corretas e recusa senha errada", async () => {
    const email = `aluno-${Date.now()}@example.com`;
    await auth.api.signUpEmail({
      body: { email, password: "senha-segura-123", name: "Aluno Teste" },
    });

    const login = await auth.api.signInEmail({
      body: { email, password: "senha-segura-123" },
    });
    expect(login.user.email).toBe(email);

    await expect(
      auth.api.signInEmail({
        body: { email, password: "senha-errada" },
      })
    ).rejects.toThrow();
  });
});
