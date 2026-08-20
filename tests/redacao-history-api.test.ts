import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { redacoes, temas } from "@/db/schema";
import { auth } from "@/lib/auth";
import { GET } from "@/app/api/redacao/redacoes/route";

async function createUserCookie() {
  const email = `aluno-historico-${crypto.randomUUID()}@example.com`;
  const signUp = await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Aluno" },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return { cookie: signIn.headers.get("set-cookie") ?? "", userId: signUp.user.id };
}

async function createGradedRedacao(userId: string) {
  const [tema] = await db
    .insert(temas)
    .values({ id: crypto.randomUUID(), title: `Tema histórico ${crypto.randomUUID()}` })
    .returning();

  const [redacao] = await db
    .insert(redacoes)
    .values({
      id: crypto.randomUUID(),
      userId,
      temaId: tema.id,
      text: "Texto de teste.",
      scores: {
        competencia1: 200,
        competencia2: 200,
        competencia3: 200,
        competencia4: 200,
        competencia5: 200,
      },
      notaTotal: 1000,
      feedback: { justificativas: ["", "", "", "", ""], comentarioGeral: "" },
    })
    .returning();

  return { redacao, tema };
}

describe("GET /api/redacao/redacoes", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/redacao/redacoes");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("retorna só as redações do próprio usuário, com o título do tema", async () => {
    const { cookie, userId } = await createUserCookie();
    const { redacao, tema } = await createGradedRedacao(userId);

    const otherUser = await createUserCookie();
    await createGradedRedacao(otherUser.userId);

    const request = new Request("http://localhost:3000/api/redacao/redacoes", {
      headers: { cookie },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.redacoes.some((r: { id: string }) => r.id === redacao.id)).toBe(true);
    const found = body.redacoes.find((r: { id: string }) => r.id === redacao.id);
    expect(found.temaTitle).toBe(tema.title);
    expect(
      body.redacoes.every((r: { id: string }) => r.id !== otherUser.userId)
    ).toBe(true);
  });
});
