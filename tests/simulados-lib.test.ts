import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";
import {
  DAY_AREAS,
  DAY_DURATIONS,
  computeOverallScore,
  computeScoreByArea,
  deriveFielAvailability,
  deriveMescladoAvailability,
  getFielAvailability,
  getMescladoAvailability,
  pickBalancedByTopic,
  pickFielQuestionIds,
  pickMescladoQuestionIds,
} from "@/lib/simulados";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 9000);
}

async function insertQuestion(overrides: {
  year: number;
  examDay: number;
  questionNumber: number;
  area: "linguagens" | "humanas" | "natureza" | "matematica";
  status?: "pendente" | "aprovada" | "rejeitada";
  correctAnswer?: string;
}) {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: overrides.area,
      subject: "Assunto teste",
      name: `Tópico ${crypto.randomUUID()}`,
    })
    .returning();

  const [question] = await db
    .insert(questions)
    .values({
      id: crypto.randomUUID(),
      year: overrides.year,
      examDay: overrides.examDay,
      questionNumber: overrides.questionNumber,
      area: overrides.area,
      statement: "teste",
      alternatives: [
        { letter: "A", text: "1" },
        { letter: "B", text: "2" },
        { letter: "C", text: "3" },
        { letter: "D", text: "4" },
        { letter: "E", text: "5" },
      ],
      correctAnswer: overrides.correctAnswer ?? "A",
      topicId: topic.id,
      status: overrides.status ?? "aprovada",
    })
    .returning();

  return question;
}

describe("DAY_DURATIONS / DAY_AREAS", () => {
  it("tem as durações oficiais do ENEM em segundos", () => {
    expect(DAY_DURATIONS[1]).toBe(19800);
    expect(DAY_DURATIONS[2]).toBe(18000);
  });

  it("mapeia dia 1 para linguagens+humanas e dia 2 para natureza+matemática", () => {
    expect(DAY_AREAS[1]).toEqual(["linguagens", "humanas"]);
    expect(DAY_AREAS[2]).toEqual(["natureza", "matematica"]);
  });
});

describe("pickFielQuestionIds", () => {
  it("retorna só as aprovadas do year+examDay exatos, na ordem de questionNumber", async () => {
    const year = randomTestYear();
    const q2 = await insertQuestion({ year, examDay: 1, questionNumber: 2, area: "linguagens" });
    const q1 = await insertQuestion({ year, examDay: 1, questionNumber: 1, area: "linguagens" });
    await insertQuestion({
      year,
      examDay: 1,
      questionNumber: 3,
      area: "linguagens",
      status: "pendente",
    });
    await insertQuestion({ year, examDay: 2, questionNumber: 1, area: "natureza" });

    const ids = await pickFielQuestionIds(year, 1);
    expect(ids).toEqual([q1.id, q2.id]);
  });

  it("inclui questões anuladas (fidelidade ao dia real)", async () => {
    const year = randomTestYear();
    const anulada = await insertQuestion({
      year,
      examDay: 1,
      questionNumber: 1,
      area: "linguagens",
      correctAnswer: "Anulado",
    });

    const ids = await pickFielQuestionIds(year, 1);
    expect(ids).toEqual([anulada.id]);
  });
});

describe("pickBalancedByTopic", () => {
  it("espalha a seleção entre os tópicos disponíveis em vez de esgotar um só", () => {
    const rows = [
      { id: "a1", topicId: "t1" },
      { id: "a2", topicId: "t1" },
      { id: "a3", topicId: "t1" },
      { id: "b1", topicId: "t2" },
      { id: "c1", topicId: "t3" },
    ];
    const picked = pickBalancedByTopic(rows, 3);
    expect(picked).toHaveLength(3);
    const topicsUsed = new Set(picked.map((id) => rows.find((r) => r.id === id)!.topicId));
    expect(topicsUsed).toEqual(new Set(["t1", "t2", "t3"]));
  });

  it("retorna todas as disponíveis, sem duplicar, quando o total pedido excede o pool", () => {
    const rows = [
      { id: "a1", topicId: "t1" },
      { id: "b1", topicId: "t2" },
    ];
    const picked = pickBalancedByTopic(rows, 10);
    expect(picked.sort()).toEqual(["a1", "b1"]);
  });

  it("nunca repete um id", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, topicId: `t${i % 4}` }));
    const picked = pickBalancedByTopic(rows, 12);
    expect(new Set(picked).size).toBe(picked.length);
  });
});

describe("pickMescladoQuestionIds", () => {
  it("retorna 45 questões de cada área do dia (90 no total), sem duplicar", async () => {
    const yearA = randomTestYear();
    for (let i = 0; i < 50; i++) {
      await insertQuestion({ year: yearA, examDay: 1, questionNumber: i + 1, area: "linguagens" });
    }
    const yearB = yearA + 1;
    for (let i = 0; i < 50; i++) {
      await insertQuestion({ year: yearB, examDay: 1, questionNumber: i + 1, area: "humanas" });
    }

    const ids = await pickMescladoQuestionIds(1);
    expect(ids.length).toBe(90);
    expect(new Set(ids).size).toBe(90);
  });

  it("exclui questões anuladas do sorteio", async () => {
    const year = randomTestYear();
    const anulada = await insertQuestion({
      year,
      examDay: 2,
      questionNumber: 1,
      area: "natureza",
      correctAnswer: "Anulado",
    });

    const ids = await pickMescladoQuestionIds(2);
    expect(ids).not.toContain(anulada.id);
  });
});

describe("deriveFielAvailability", () => {
  it("marca disponível só quando aprovadas >= 90", () => {
    const result = deriveFielAvailability([
      { year: 2025, examDay: 1, aprovadas: 89 },
      { year: 2025, examDay: 2, aprovadas: 90 },
    ]);
    expect(result.find((r) => r.examDay === 1)!.disponivel).toBe(false);
    expect(result.find((r) => r.examDay === 2)!.disponivel).toBe(true);
    expect(result.every((r) => r.necessarias === 90)).toBe(true);
  });
});

describe("deriveMescladoAvailability", () => {
  it("marca o dia disponível só quando AMBAS as áreas do dia têm >= 45", () => {
    const result = deriveMescladoAvailability([
      { area: "linguagens", aprovadas: 45 },
      { area: "humanas", aprovadas: 44 },
      { area: "natureza", aprovadas: 45 },
      { area: "matematica", aprovadas: 45 },
    ]);
    expect(result.find((r) => r.examDay === 1)!.disponivel).toBe(false);
    expect(result.find((r) => r.examDay === 2)!.disponivel).toBe(true);
  });

  it("trata área sem nenhuma aprovada como 0, não como ausente", () => {
    const result = deriveMescladoAvailability([{ area: "linguagens", aprovadas: 50 }]);
    const dia1 = result.find((r) => r.examDay === 1)!;
    expect(dia1.areas.find((a) => a.area === "humanas")!.aprovadas).toBe(0);
    expect(dia1.disponivel).toBe(false);
  });
});

describe("getFielAvailability (integração)", () => {
  it("reflete as aprovadas reais de um year+day isolado", async () => {
    const year = randomTestYear();
    for (let i = 0; i < 3; i++) {
      await insertQuestion({ year, examDay: 1, questionNumber: i + 1, area: "linguagens" });
    }
    const result = await getFielAvailability();
    const found = result.find((r) => r.year === year && r.examDay === 1);
    expect(found?.aprovadas).toBe(3);
    expect(found?.disponivel).toBe(false);
  });
});

describe("getMescladoAvailability (integração)", () => {
  it("aumenta a contagem da área conforme aprovadas são inseridas", async () => {
    const before = await getMescladoAvailability();
    const beforeCount = before
      .find((d) => d.examDay === 1)!
      .areas.find((a) => a.area === "linguagens")!.aprovadas;

    const year = randomTestYear();
    for (let i = 0; i < 4; i++) {
      await insertQuestion({ year, examDay: 1, questionNumber: i + 1, area: "linguagens" });
    }

    const after = await getMescladoAvailability();
    const afterCount = after
      .find((d) => d.examDay === 1)!
      .areas.find((a) => a.area === "linguagens")!.aprovadas;

    expect(afterCount - beforeCount).toBe(4);
  });
});

describe("computeScoreByArea", () => {
  it("conta acertos e total por área, ignorando anuladas", () => {
    const result = computeScoreByArea([
      { area: "linguagens", selectedAnswer: "A", correctAnswer: "A" },
      { area: "linguagens", selectedAnswer: "B", correctAnswer: "A" },
      { area: "linguagens", selectedAnswer: null, correctAnswer: "Anulado" },
      { area: "humanas", selectedAnswer: "C", correctAnswer: "C" },
    ]);
    expect(result.find((r) => r.area === "linguagens")).toEqual({
      area: "linguagens",
      acertos: 1,
      total: 2,
    });
    expect(result.find((r) => r.area === "humanas")).toEqual({
      area: "humanas",
      acertos: 1,
      total: 1,
    });
  });
});

describe("computeOverallScore", () => {
  it("soma acertos e total de todas as áreas", () => {
    const result = computeOverallScore([
      { area: "linguagens", selectedAnswer: "A", correctAnswer: "A" },
      { area: "humanas", selectedAnswer: "X", correctAnswer: "C" },
    ]);
    expect(result).toEqual({ acertos: 1, total: 2 });
  });
});
