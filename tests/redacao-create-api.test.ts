import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { redacoes, temas } from "@/db/schema";
import { auth } from "@/lib/auth";

vi.mock("@/lib/redacao", () => ({
  gradeRedacao: vi.fn(),
}));

import { gradeRedacao } from "@/lib/redacao";
import { POST } from "@/app/api/redacao/redacoes/route";

async function createUserCookie() {
  const email = `aluno-redacao-${crypto.randomUUID()}@example.com`;
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
    .values({ id: crypto.randomUUID(), title: `Tema criação ${crypto.randomUUID()}` })
    .returning();
  return tema;
}

const LONG_ENOUGH_TEXT = Array.from({ length: 60 }, () => "palavra").join(" ");

describe("POST /api/redacao/redacoes", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/redacao/redacoes", {
      method: "POST",
      body: JSON.stringify({ temaId: "x", text: LONG_ENOUGH_TEXT }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("retorna 400 quando o texto tem menos de 50 palavras", async () => {
    const cookie = await createUserCookie();
    const tema = await createTema();
    const request = new Request("http://localhost:3000/api/redacao/redacoes", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ temaId: tema.id, text: "texto curto demais" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("retorna 400 quando o texto passa de 3000 caracteres", async () => {
    const cookie = await createUserCookie();
    const tema = await createTema();
    const tooLongText = Array.from({ length: 500 }, () => "palavra").join(" ");
    const request = new Request("http://localhost:3000/api/redacao/redacoes", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ temaId: tema.id, text: tooLongText }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("retorna 400 para temaId inexistente", async () => {
    const cookie = await createUserCookie();
    const request = new Request("http://localhost:3000/api/redacao/redacoes", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ temaId: crypto.randomUUID(), text: LONG_ENOUGH_TEXT }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("corrige e grava a redação quando a IA responde com sucesso", async () => {
    const cookie = await createUserCookie();
    const tema = await createTema();
    vi.mocked(gradeRedacao).mockResolvedValue({
      scores: {
        competencia1: 200,
        competencia2: 160,
        competencia3: 120,
        competencia4: 200,
        competencia5: 160,
      },
      notaTotal: 840,
      feedback: { justificativas: ["a", "b", "c", "d", "e"], comentarioGeral: "Bom." },
    });

    const request = new Request("http://localhost:3000/api/redacao/redacoes", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ temaId: tema.id, text: LONG_ENOUGH_TEXT }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.notaTotal).toBe(840);

    const saved = await db.select().from(redacoes).where(eq(redacoes.temaId, tema.id));
    expect(saved).toHaveLength(1);
    expect(saved[0].notaTotal).toBe(840);
  });

  it("retorna 502 e não grava nada quando a IA falha", async () => {
    const cookie = await createUserCookie();
    const tema = await createTema();
    vi.mocked(gradeRedacao).mockRejectedValue(new Error("timeout"));

    const request = new Request("http://localhost:3000/api/redacao/redacoes", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ temaId: tema.id, text: LONG_ENOUGH_TEXT }),
    });
    const response = await POST(request);
    expect(response.status).toBe(502);

    const saved = await db.select().from(redacoes).where(eq(redacoes.temaId, tema.id));
    expect(saved).toHaveLength(0);
  });
});
