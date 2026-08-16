import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user, topics, questions } from "@/db/schema";

// Anos fora da faixa real do ENEM, derivados de Date.now() para não colidir
// com a restrição de unicidade (year, examDay, questionNumber) entre
// execuções repetidas da suíte contra o mesmo Postgres local.
function randomTestYear(): number {
  return 90000 + (Date.now() % 9000);
}

describe("schema de questões", () => {
  it("cria um topic e uma question referenciando ele", async () => {
    const [topic] = await db
      .insert(topics)
      .values({
        id: crypto.randomUUID(),
        area: "natureza",
        subject: "Física",
        name: "Óptica — Lentes",
      })
      .returning();

    const testYear = randomTestYear();
    const [question] = await db
      .insert(questions)
      .values({
        id: crypto.randomUUID(),
        year: testYear,
        examDay: 2,
        questionNumber: 91,
        area: "natureza",
        statement: "Uma lente convexa...",
        alternatives: [
          { letter: "A", text: "..." },
          { letter: "B", text: "..." },
          { letter: "C", text: "..." },
          { letter: "D", text: "..." },
          { letter: "E", text: "..." },
        ],
        correctAnswer: "C",
        topicId: topic.id,
        status: "pendente",
      })
      .returning();

    expect(question.topicId).toBe(topic.id);
    expect(question.status).toBe("pendente");
    expect(question.alternatives).toHaveLength(5);
  });

  it("rejeita duas questões com o mesmo ano+dia+número", async () => {
    const topicId = crypto.randomUUID();
    await db.insert(topics).values({
      id: topicId,
      area: "matematica",
      subject: "Matemática",
      name: "Geometria",
    });

    const base = {
      year: randomTestYear(),
      examDay: 1 as const,
      questionNumber: 1,
      area: "matematica" as const,
      statement: "x",
      alternatives: [
        { letter: "A", text: "1" },
        { letter: "B", text: "2" },
        { letter: "C", text: "3" },
        { letter: "D", text: "4" },
        { letter: "E", text: "5" },
      ],
      correctAnswer: "A",
      topicId,
      status: "pendente" as const,
    };

    await db.insert(questions).values({ id: crypto.randomUUID(), ...base });

    await expect(
      db.insert(questions).values({ id: crypto.randomUUID(), ...base })
    ).rejects.toThrow();
  });

  it("user tem role padrão 'aluno' e aceita 'admin'", async () => {
    const [created] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: "Aluno Teste",
        email: `aluno-${crypto.randomUUID()}@example.com`,
        emailVerified: false,
      })
      .returning();
    expect(created.role).toBe("aluno");

    await db.update(user).set({ role: "admin" }).where(eq(user.id, created.id));
    const [updated] = await db.select().from(user).where(eq(user.id, created.id));
    expect(updated.role).toBe("admin");
  });
});
