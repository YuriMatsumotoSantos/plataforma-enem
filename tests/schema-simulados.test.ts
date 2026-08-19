import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { questions, simulados, topics, user } from "@/db/schema";
import { randomTestYear } from "@/tests/helpers";

async function createTestQuestionAndUser() {
  const [topic] = await db
    .insert(topics)
    .values({ id: crypto.randomUUID(), area: "matematica", subject: "Matemática", name: "Álgebra" })
    .returning();

  const [question] = await db
    .insert(questions)
    .values({
      id: crypto.randomUUID(),
      year: randomTestYear(),
      examDay: 1,
      questionNumber: 1,
      area: "matematica",
      statement: "teste",
      alternatives: [
        { letter: "A", text: "1" },
        { letter: "B", text: "2" },
        { letter: "C", text: "3" },
        { letter: "D", text: "4" },
        { letter: "E", text: "5" },
      ],
      correctAnswer: "A",
      topicId: topic.id,
      status: "aprovada",
    })
    .returning();

  const [testUser] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Aluno Teste",
      email: `aluno-${crypto.randomUUID()}@example.com`,
      emailVerified: false,
    })
    .returning();

  return { question, testUser };
}

describe("schema de simulados", () => {
  it("cria um simulado com defaults corretos (status, answers)", async () => {
    const { question, testUser } = await createTestQuestionAndUser();

    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        mode: "mesclado",
        examDay: 1,
        questionIds: [question.id],
        durationSeconds: 19800,
      })
      .returning();

    expect(simulado.status).toBe("em_andamento");
    expect(simulado.answers).toEqual({});
    expect(simulado.questionIds).toEqual([question.id]);
    expect(simulado.finishedAt).toBeNull();
  });

  it("rejeita userId inexistente", async () => {
    const { question } = await createTestQuestionAndUser();

    await expect(
      db.insert(simulados).values({
        id: crypto.randomUUID(),
        userId: crypto.randomUUID(),
        mode: "fiel",
        examDay: 1,
        examYear: 2025,
        questionIds: [question.id],
        durationSeconds: 19800,
      })
    ).rejects.toThrow();
  });
});
