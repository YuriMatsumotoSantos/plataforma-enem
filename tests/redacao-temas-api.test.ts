import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { temas } from "@/db/schema";
import { auth } from "@/lib/auth";
import { GET } from "@/app/api/redacao/temas/route";

async function createUserCookie() {
  const email = `aluno-temas-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({ body: { email, password: "senha-segura-123", name: "Aluno" } });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return signIn.headers.get("set-cookie") ?? "";
}

describe("GET /api/redacao/temas", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/redacao/temas");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("retorna a lista de temas com sessão válida", async () => {
    const title = `Tema listagem ${crypto.randomUUID()}`;
    await db.insert(temas).values({ id: crypto.randomUUID(), title });

    const cookie = await createUserCookie();
    const request = new Request("http://localhost:3000/api/redacao/temas", {
      headers: { cookie },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.temas.some((t: { title: string }) => t.title === title)).toBe(true);
  });
});
