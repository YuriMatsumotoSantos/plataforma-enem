import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { questions, topicProgress, topics, user } from "@/db/schema";
import { getRecommendedSession, selectRecommendedTopics, type CandidateTopic } from "@/lib/recommended-session";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 900000);
}

async function createTopicWithApprovedQuestion(name: string) {
  const [topic] = await db
    .insert(topics)
    .values({ id: crypto.randomUUID(), area: "matematica", subject: "Matemática", name })
    .returning();

  await db.insert(questions).values({
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
  });

  return topic;
}

async function createUserId() {
  const [testUser] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Aluno Teste",
      email: `aluno-${crypto.randomUUID()}@example.com`,
      emailVerified: false,
    })
    .returning();
  return testUser.id;
}

function makeTopic(id: string): CandidateTopic {
  return { topicId: id, subject: "Matemática", area: "matematica", name: `Assunto ${id}` };
}

describe("selectRecommendedTopics", () => {
  it("prioriza vencidos, depois fracos, depois nunca-praticados, até o limite", () => {
    const vencidos = [makeTopic("v1"), makeTopic("v2")];
    const fracos = [makeTopic("f1"), makeTopic("f2")];
    const neverAttempted = [makeTopic("n1"), makeTopic("n2")];

    const result = selectRecommendedTopics(vencidos, fracos, neverAttempted, 5);

    expect(result.map((t) => t.topicId)).toEqual(["v1", "v2", "f1", "f2", "n1"]);
  });

  it("não repete um topicId presente em mais de uma lista", () => {
    const vencidos = [makeTopic("shared")];
    const fracos = [makeTopic("shared"), makeTopic("f1")];
    const neverAttempted: CandidateTopic[] = [];

    const result = selectRecommendedTopics(vencidos, fracos, neverAttempted, 5);

    expect(result.map((t) => t.topicId)).toEqual(["shared", "f1"]);
  });

  it("sem vencidos nem fracos, cai inteiramente para nunca-praticados", () => {
    const neverAttempted = [makeTopic("n1"), makeTopic("n2"), makeTopic("n3")];

    const result = selectRecommendedTopics([], [], neverAttempted, 5);

    expect(result.map((t) => t.topicId)).toEqual(["n1", "n2", "n3"]);
  });

  it("respeita o limite mesmo com candidatos de sobra", () => {
    const neverAttempted = [makeTopic("n1"), makeTopic("n2"), makeTopic("n3")];
    const result = selectRecommendedTopics([], [], neverAttempted, 2);
    expect(result).toHaveLength(2);
  });
});

describe("getRecommendedSession", () => {
  it("preenche com nunca-praticados mesmo quando vencidos e fracos se sobrepõem totalmente", async () => {
    const userId = await createUserId();

    // 3 topics that are simultaneously overdue (dueAt in the past) AND weak
    // (difficulty >= WEAK_DIFFICULTY_THRESHOLD) — full overlap between
    // vencidos and fracos. A naive `MAX_TOPICS - vencidos.length -
    // fracos.length` would compute needed = 5 - 3 - 3 = -1 here and wrongly
    // skip the never-attempted fallback, even though only 3 distinct topics
    // are actually covered and 2 slots remain.
    const overlapping = await Promise.all(
      ["Assunto A", "Assunto B", "Assunto C"].map((name) => createTopicWithApprovedQuestion(name))
    );
    const past = new Date(Date.now() - 60_000);
    await db.insert(topicProgress).values(
      overlapping.map((topic) => ({
        id: crypto.randomUUID(),
        userId,
        topicId: topic.id,
        stability: 1,
        difficulty: 7,
        state: 2,
        lapses: 0,
        reps: 1,
        dueAt: past,
        lastReviewedAt: past,
      }))
    );

    // 2 more topics never attempted at all, so they're only eligible via
    // the never-attempted fallback.
    await Promise.all(
      ["Assunto D", "Assunto E"].map((name) => createTopicWithApprovedQuestion(name))
    );

    const { topics: selected } = await getRecommendedSession(userId);

    expect(selected).toHaveLength(5);
    const overlappingIds = new Set(overlapping.map((t) => t.id));
    const neverAttemptedCount = selected.filter((t) => !overlappingIds.has(t.topicId)).length;
    expect(neverAttemptedCount).toBe(2);
  });
});
