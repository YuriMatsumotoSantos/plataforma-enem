import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";
import { questionAlreadyExists } from "@/scripts/ingest/idempotency";

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
