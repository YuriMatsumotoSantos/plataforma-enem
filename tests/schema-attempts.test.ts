import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { attempts, questions, topics, user } from "@/db/schema";

function randomTestYear(): number {
  return 90000 + (Date.now() % 9000);
}

async function createTestQuestionAndUser() {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: "matematica",
      subject: "Matemática",
      name: "Álgebra",
    })
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

describe("schema de attempts", () => {
  it("cria um attempt referenciando uma question e um user reais", async () => {
    const { question, testUser } = await createTestQuestionAndUser();

    const [attempt] = await db
      .insert(attempts)
      .values({
        id: crypto.randomUUID(),
        questionId: question.id,
        userId: testUser.id,
        selectedAnswer: "A",
        isCorrect: true,
      })
      .returning();

    expect(attempt.questionId).toBe(question.id);
    expect(attempt.userId).toBe(testUser.id);
    expect(attempt.isCorrect).toBe(true);
  });

  it("rejeita attempt com questionId inexistente", async () => {
    const { testUser } = await createTestQuestionAndUser();

    await expect(
      db.insert(attempts).values({
        id: crypto.randomUUID(),
        questionId: crypto.randomUUID(),
        userId: testUser.id,
        selectedAnswer: "A",
        isCorrect: false,
      })
    ).rejects.toThrow();
  });
});
