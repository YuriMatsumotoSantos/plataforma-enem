import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { redacoes, temas } from "@/db/schema";
import { auth } from "@/lib/auth";
import { GET } from "@/app/api/redacao/redacoes/[id]/route";

async function createUserCookie() {
  const email = `aluno-detalhe-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({ body: { email, password: "senha-segura-123", name: "Aluno" } });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return signIn.headers.get("set-cookie") ?? "";
}

async function createTema() {
  const [tema] = await db
    .insert(temas)
    .values({ id: crypto.randomUUID(), title: `Tema detalhe ${crypto.randomUUID()}` })
    .returning();
  return tema;
}

describe("GET /api/redacao/redacoes/[id]", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/redacao/redacoes/abc");
    const response = await GET(request, { params: Promise.resolve({ id: "abc" }) });
    expect(response.status).toBe(401);
  });

  it("retorna 404 para id inexistente", async () => {
    const cookie = await createUserCookie();
    const request = new Request("http://localhost:3000/api/redacao/redacoes/abc", {
      headers: { cookie },
    });
    const response = await GET(request, { params: Promise.resolve({ id: crypto.randomUUID() }) });
    expect(response.status).toBe(404);
  });

  it("retorna 404 quando a redação pertence a outro usuário", async () => {
    const tema = await createTema();

    let ownerUserId = "";
    {
      const email = `dono-${crypto.randomUUID()}@example.com`;
      const signUp = await auth.api.signUpEmail({
        body: { email, password: "senha-segura-123", name: "Dono" },
      });
      ownerUserId = signUp.user.id;
    }

    const [redacao] = await db
      .insert(redacoes)
      .values({
        id: crypto.randomUUID(),
        userId: ownerUserId,
        temaId: tema.id,
        text: "Texto.",
        scores: {
          competencia1: 0,
          competencia2: 0,
          competencia3: 0,
          competencia4: 0,
          competencia5: 0,
        },
        notaTotal: 0,
        feedback: { justificativas: ["", "", "", "", ""], comentarioGeral: "" },
      })
      .returning();

    const otherCookie = await createUserCookie();
    const request = new Request(`http://localhost:3000/api/redacao/redacoes/${redacao.id}`, {
      headers: { cookie: otherCookie },
    });
    const response = await GET(request, { params: Promise.resolve({ id: redacao.id }) });
    expect(response.status).toBe(404);
  });

  it("retorna a redação completa para o dono", async () => {
    const email = `dono2-${crypto.randomUUID()}@example.com`;
    const signUp = await auth.api.signUpEmail({
      body: { email, password: "senha-segura-123", name: "Dono" },
    });
    const signIn = await auth.api.signInEmail({
      body: { email, password: "senha-segura-123" },
      asResponse: true,
    });
    const cookie = signIn.headers.get("set-cookie") ?? "";

    const [tema] = await db
      .insert(temas)
      .values({ id: crypto.randomUUID(), title: `Tema detalhe dono ${crypto.randomUUID()}` })
      .returning();

    const [redacao] = await db
      .insert(redacoes)
      .values({
        id: crypto.randomUUID(),
        userId: signUp.user.id,
        temaId: tema.id,
        text: "Texto completo.",
        scores: {
          competencia1: 200,
          competencia2: 200,
          competencia3: 200,
          competencia4: 200,
          competencia5: 200,
        },
        notaTotal: 1000,
        feedback: { justificativas: ["a", "b", "c", "d", "e"], comentarioGeral: "Perfeito." },
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/redacao/redacoes/${redacao.id}`, {
      headers: { cookie },
    });
    const response = await GET(request, { params: Promise.resolve({ id: redacao.id }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.notaTotal).toBe(1000);
    expect(body.text).toBe("Texto completo.");
  });
});
