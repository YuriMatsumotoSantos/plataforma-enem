import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";

describe("requireAdmin", () => {
  it("retorna null sem sessão", async () => {
    const request = new Request("http://localhost:3000/admin/revisao");
    const result = await requireAdmin(request);
    expect(result).toBeNull();
  });

  it("retorna null para usuário autenticado sem role admin", async () => {
    const email = `aluno-${crypto.randomUUID()}@example.com`;
    await auth.api.signUpEmail({
      body: { email, password: "senha-segura-123", name: "Aluno" },
    });
    const signIn = await auth.api.signInEmail({
      body: { email, password: "senha-segura-123" },
      asResponse: true,
    });
    const cookie = signIn.headers.get("set-cookie") ?? "";

    const request = new Request("http://localhost:3000/admin/revisao", {
      headers: { cookie },
    });
    const result = await requireAdmin(request);
    expect(result).toBeNull();
  });

  it("retorna a sessão para usuário admin", async () => {
    const email = `admin-${crypto.randomUUID()}@example.com`;
    const signUp = await auth.api.signUpEmail({
      body: { email, password: "senha-segura-123", name: "Admin" },
    });
    await db.update(user).set({ role: "admin" }).where(eq(user.id, signUp.user.id));

    const signIn = await auth.api.signInEmail({
      body: { email, password: "senha-segura-123" },
      asResponse: true,
    });
    const cookie = signIn.headers.get("set-cookie") ?? "";

    const request = new Request("http://localhost:3000/admin/revisao", {
      headers: { cookie },
    });
    const result = await requireAdmin(request);
    expect(result).not.toBeNull();
    expect(result!.user.email).toBe(email);
    expect(result!.user.role).toBe("admin");
  });
});
