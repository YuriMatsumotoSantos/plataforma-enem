import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";
import { questionAlreadyExists, countExistingQuestions } from "@/scripts/ingest/idempotency";

describe("questionAlreadyExists", () => {
  it("retorna false quando a questão não existe", async () => {
    // Use random year to avoid collisions with previous test runs
    const randomYear = Math.floor(Math.random() * 10000) + 10000;
    const result = await questionAlreadyExists(randomYear, 1, 999);
    expect(result).toBe(false);
  });

  it("retorna true quando a questão já existe (em qualquer status)", async () => {
    // Use random year to avoid collisions with previous test runs
    const randomYear = Math.floor(Math.random() * 10000) + 20000;

    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "humanas", subject: "História", name: "Brasil Colônia" })
      .returning();

    await db.insert(questions).values({
      id: crypto.randomUUID(),
      year: randomYear,
      examDay: 1,
      questionNumber: 5,
      area: "humanas",
      statement: "x",
      alternatives: [
        { letter: "A", text: "1" },
        { letter: "B", text: "2" },
        { letter: "C", text: "3" },
        { letter: "D", text: "4" },
        { letter: "E", text: "5" },
      ],
      correctAnswer: "A",
      topicId: topic.id,
      status: "rejeitada",
    });

    const result = await questionAlreadyExists(randomYear, 1, 5);
    expect(result).toBe(true);
  });
});

describe("countExistingQuestions", () => {
  it("retorna 0 quando não existe nenhuma questão pra aquele (year, examDay)", async () => {
    const randomYear = Math.floor(Math.random() * 10000) + 30000;
    const result = await countExistingQuestions(randomYear, 1);
    expect(result).toBe(0);
  });

  it("retorna a contagem correta quando existem N questões", async () => {
    const randomYear = Math.floor(Math.random() * 10000) + 40000;

    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "humanas", subject: "História", name: "Brasil Colônia" })
      .returning();

    // Insere 3 questões com o mesmo year/examDay
    for (let i = 1; i <= 3; i++) {
      await db.insert(questions).values({
        id: crypto.randomUUID(),
        year: randomYear,
        examDay: 1,
        questionNumber: i,
        area: "humanas",
        statement: `questão ${i}`,
        alternatives: [
          { letter: "A", text: "1" },
          { letter: "B", text: "2" },
          { letter: "C", text: "3" },
          { letter: "D", text: "4" },
          { letter: "E", text: "5" },
        ],
        correctAnswer: "A",
        topicId: topic.id,
        status: "pendente",
      });
    }

    const result = await countExistingQuestions(randomYear, 1);
    expect(result).toBe(3);
  });
});
