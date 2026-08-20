import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user, temas, redacoes } from "@/db/schema";

async function createTestUser() {
  const [row] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Aluno Teste",
      email: `redacao-schema-${crypto.randomUUID()}@example.com`,
      emailVerified: false,
    })
    .returning();
  return row;
}

describe("schema: temas e redacoes", () => {
  it("insere um tema e lê de volta", async () => {
    const [tema] = await db
      .insert(temas)
      .values({ id: crypto.randomUUID(), title: `Tema teste ${crypto.randomUUID()}` })
      .returning();

    const [found] = await db.select().from(temas).where(eq(temas.id, tema.id));
    expect(found.title).toBe(tema.title);
  });

  it("insere uma redação com scores e feedback em JSONB e lê de volta", async () => {
    const testUser = await createTestUser();
    const [tema] = await db
      .insert(temas)
      .values({ id: crypto.randomUUID(), title: `Tema teste ${crypto.randomUUID()}` })
      .returning();

    const scores = {
      competencia1: 200,
      competencia2: 160,
      competencia3: 120,
      competencia4: 200,
      competencia5: 160,
    };
    const feedback = {
      justificativas: ["ok", "ok", "ok", "ok", "ok"],
      comentarioGeral: "Bom texto.",
    };

    const [redacao] = await db
      .insert(redacoes)
      .values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        temaId: tema.id,
        text: "Texto de teste com pelo menos algumas palavras.",
        scores,
        notaTotal: 840,
        feedback,
      })
      .returning();

    const [found] = await db.select().from(redacoes).where(eq(redacoes.id, redacao.id));
    expect(found.scores).toEqual(scores);
    expect(found.feedback).toEqual(feedback);
    expect(found.notaTotal).toBe(840);
  });

  it("apaga redações do usuário em cascata quando o usuário é apagado", async () => {
    const testUser = await createTestUser();
    const [tema] = await db
      .insert(temas)
      .values({ id: crypto.randomUUID(), title: `Tema teste ${crypto.randomUUID()}` })
      .returning();

    const [redacao] = await db
      .insert(redacoes)
      .values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        temaId: tema.id,
        text: "Texto de teste.",
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

    await db.delete(user).where(eq(user.id, testUser.id));

    const remaining = await db.select().from(redacoes).where(eq(redacoes.id, redacao.id));
    expect(remaining).toHaveLength(0);
  });
});
