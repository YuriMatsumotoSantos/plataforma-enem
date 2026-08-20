import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { topicProgress, topics, user } from "@/db/schema";

async function createTopicAndUser() {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: "matematica",
      subject: "Matemática",
      name: "Álgebra",
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

  return { topic, testUser };
}

describe("schema de topic_progress", () => {
  it("cria um topic_progress referenciando um topic e um user reais", async () => {
    const { topic, testUser } = await createTopicAndUser();
    const now = new Date();

    const [row] = await db
      .insert(topicProgress)
      .values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        topicId: topic.id,
        stability: 1.5,
        difficulty: 5,
        state: 1,
        lapses: 0,
        reps: 1,
        dueAt: now,
        lastReviewedAt: now,
      })
      .returning();

    expect(row.topicId).toBe(topic.id);
    expect(row.userId).toBe(testUser.id);
    expect(row.stability).toBeCloseTo(1.5);
    expect(row.state).toBe(1);
  });

  it("rejeita topicId inexistente", async () => {
    const { testUser } = await createTopicAndUser();
    const now = new Date();

    await expect(
      db.insert(topicProgress).values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        topicId: crypto.randomUUID(),
        stability: 1,
        difficulty: 1,
        state: 0,
        lapses: 0,
        reps: 0,
        dueAt: now,
        lastReviewedAt: now,
      })
    ).rejects.toThrow();
  });

  it("rejeita um segundo topic_progress para o mesmo (userId, topicId)", async () => {
    const { topic, testUser } = await createTopicAndUser();
    const now = new Date();
    const values = {
      userId: testUser.id,
      topicId: topic.id,
      stability: 1,
      difficulty: 1,
      state: 0,
      lapses: 0,
      reps: 0,
      dueAt: now,
      lastReviewedAt: now,
    };

    await db.insert(topicProgress).values({ id: crypto.randomUUID(), ...values });

    await expect(
      db.insert(topicProgress).values({ id: crypto.randomUUID(), ...values })
    ).rejects.toThrow();
  });
});
