import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { attempts, questions, topics, topicProgress, user } from "@/db/schema";
import {
  applyProgressUpdate,
  getOrUpdateTopicProgress,
  getTopicsNeedingRecompute,
} from "@/lib/topic-progress";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 900000);
}

async function createFixture() {
  const [topic] = await db
    .insert(topics)
    .values({ id: crypto.randomUUID(), area: "matematica", subject: "Matemática", name: "Álgebra" })
    .returning();

  const alternatives = [
    { letter: "A", text: "1" },
    { letter: "B", text: "2" },
    { letter: "C", text: "3" },
    { letter: "D", text: "4" },
    { letter: "E", text: "5" },
  ];

  const [question] = await db
    .insert(questions)
    .values({
      id: crypto.randomUUID(),
      year: randomTestYear(),
      examDay: 1,
      questionNumber: 1,
      area: "matematica",
      statement: "teste",
      alternatives,
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

  return { topic, question, testUser };
}

async function recordAttempt(questionId: string, userId: string, isCorrect: boolean) {
  await db.insert(attempts).values({
    id: crypto.randomUUID(),
    questionId,
    userId,
    selectedAnswer: isCorrect ? "A" : "B",
    isCorrect,
  });
}

describe("getTopicsNeedingRecompute", () => {
  it("inclui um topic com tentativas mas sem topic_progress ainda", async () => {
    const { topic, question, testUser } = await createFixture();
    await recordAttempt(question.id, testUser.id, true);

    const result = await getTopicsNeedingRecompute(testUser.id);
    expect(result).toContain(topic.id);
  });

  it("não inclui um topic sem nenhuma tentativa", async () => {
    const { topic, testUser } = await createFixture();
    const result = await getTopicsNeedingRecompute(testUser.id);
    expect(result).not.toContain(topic.id);
  });
});

describe("getOrUpdateTopicProgress", () => {
  it("cria o primeiro topic_progress a partir de tentativas novas", async () => {
    const { topic, question, testUser } = await createFixture();
    await recordAttempt(question.id, testUser.id, true);
    await recordAttempt(question.id, testUser.id, true);

    const progress = await getOrUpdateTopicProgress(testUser.id, topic.id);

    expect(progress).not.toBeNull();
    expect(progress!.reps).toBe(1);
    expect(progress!.dueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("sem tentativas novas desde a última revisão, não muda nada", async () => {
    const { topic, question, testUser } = await createFixture();
    await recordAttempt(question.id, testUser.id, true);
    const first = await getOrUpdateTopicProgress(testUser.id, topic.id);

    const second = await getOrUpdateTopicProgress(testUser.id, topic.id);

    expect(second!.lastReviewedAt).toEqual(first!.lastReviewedAt);
    expect(second!.reps).toBe(first!.reps);
  });

  it("com tentativas novas, avança lastReviewedAt e reps", async () => {
    const { topic, question, testUser } = await createFixture();
    await recordAttempt(question.id, testUser.id, true);
    const first = await getOrUpdateTopicProgress(testUser.id, topic.id);

    await recordAttempt(question.id, testUser.id, true);
    const second = await getOrUpdateTopicProgress(testUser.id, topic.id);

    expect(second!.reps).toBe(first!.reps + 1);
    expect(second!.lastReviewedAt.getTime()).toBeGreaterThan(first!.lastReviewedAt.getTime());
  });

  it("sem nenhuma tentativa, devolve null", async () => {
    const { topic, testUser } = await createFixture();
    const progress = await getOrUpdateTopicProgress(testUser.id, topic.id);
    expect(progress).toBeNull();
  });

  it("uma segunda inserção concorrente para o mesmo (userId, topicId) não lança erro de unique constraint", async () => {
    const { topic, testUser } = await createFixture();
    const now = new Date();
    const base = {
      stability: 1,
      difficulty: 5,
      state: 1,
      lapses: 0,
      reps: 1,
      dueAt: now,
      lastReviewedAt: now,
    };

    const [first] = await db
      .insert(topicProgress)
      .values({ id: crypto.randomUUID(), userId: testUser.id, topicId: topic.id, ...base })
      .onConflictDoNothing({ target: [topicProgress.userId, topicProgress.topicId] })
      .returning();
    expect(first).toBeDefined();

    const secondInsert = await db
      .insert(topicProgress)
      .values({ id: crypto.randomUUID(), userId: testUser.id, topicId: topic.id, ...base })
      .onConflictDoNothing({ target: [topicProgress.userId, topicProgress.topicId] })
      .returning();

    expect(secondInsert).toEqual([]);

    const [winner] = await db
      .select()
      .from(topicProgress)
      .where(and(eq(topicProgress.userId, testUser.id), eq(topicProgress.topicId, topic.id)));
    expect(winner!.id).toBe(first!.id);
  });
});

describe("applyProgressUpdate (guarda de concorrência)", () => {
  it("aplica a atualização quando expectedLastReviewedAt bate com o valor atual, e a rejeita na segunda tentativa com o mesmo valor esperado", async () => {
    const { topic, testUser } = await createFixture();
    const t0 = new Date("2026-08-01T00:00:00Z");

    const [existing] = await db
      .insert(topicProgress)
      .values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        topicId: topic.id,
        stability: 1,
        difficulty: 5,
        state: 1,
        lapses: 0,
        reps: 1,
        dueAt: t0,
        lastReviewedAt: t0,
      })
      .returning();

    const t1 = new Date("2026-08-10T00:00:00Z");
    const progressA = {
      stability: 2,
      difficulty: 5,
      state: 2,
      lapses: 0,
      reps: 2,
      dueAt: new Date("2026-08-20T00:00:00Z"),
      lastReviewedAt: t1,
    };

    const firstUpdate = await applyProgressUpdate(existing.id, t0, progressA);
    expect(firstUpdate).toBeDefined();
    expect(firstUpdate!.lastReviewedAt).toEqual(t1);

    const t2 = new Date("2026-08-11T00:00:00Z");
    const progressB = { ...progressA, reps: 3, lastReviewedAt: t2 };
    const secondUpdate = await applyProgressUpdate(existing.id, t0, progressB);
    expect(secondUpdate).toBeUndefined();
  });
});
