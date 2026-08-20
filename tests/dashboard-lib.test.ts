import { describe, it, expect } from "vitest";
import { selectVencidos, selectFracos, type TopicProgressWithTopic } from "@/lib/dashboard";

function makeRow(overrides: Partial<TopicProgressWithTopic>): TopicProgressWithTopic {
  return {
    topicId: crypto.randomUUID(),
    subject: "Matemática",
    area: "matematica",
    name: "Álgebra",
    dueAt: new Date("2026-09-01T00:00:00Z"),
    difficulty: 3,
    ...overrides,
  };
}

describe("selectVencidos", () => {
  it("filtra só dueAt <= now, ordenado do mais atrasado primeiro", () => {
    const now = new Date("2026-08-20T00:00:00Z");
    const overdue1 = makeRow({ dueAt: new Date("2026-08-10T00:00:00Z") });
    const overdue2 = makeRow({ dueAt: new Date("2026-08-05T00:00:00Z") });
    const notDue = makeRow({ dueAt: new Date("2026-09-01T00:00:00Z") });

    const result = selectVencidos([overdue1, notDue, overdue2], now);

    expect(result.map((r) => r.topicId)).toEqual([overdue2.topicId, overdue1.topicId]);
  });
});

describe("selectFracos", () => {
  it("filtra difficulty >= 6, ordenado do mais difícil primeiro", () => {
    const weak1 = makeRow({ difficulty: 6 });
    const weak2 = makeRow({ difficulty: 9 });
    const notWeak = makeRow({ difficulty: 5.9 });

    const result = selectFracos([weak1, notWeak, weak2]);

    expect(result.map((r) => r.topicId)).toEqual([weak2.topicId, weak1.topicId]);
  });
});
