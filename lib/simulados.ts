import { and, count, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { examArea, questions } from "@/db/schema";

export type ExamArea = (typeof examArea.enumValues)[number];

export const DAY_DURATIONS: Record<1 | 2, number> = { 1: 19800, 2: 18000 };

export const DAY_AREAS: Record<1 | 2, [ExamArea, ExamArea]> = {
  1: ["linguagens", "humanas"],
  2: ["natureza", "matematica"],
};

const FIEL_REQUIRED = 90;
const QUESTIONS_PER_AREA = 45;

export type FielAvailability = {
  year: number;
  examDay: number;
  aprovadas: number;
  necessarias: number;
  disponivel: boolean;
};

export type MescladoAvailability = {
  examDay: 1 | 2;
  areas: { area: ExamArea; aprovadas: number; necessarias: number }[];
  disponivel: boolean;
};

export type ScoredQuestion = {
  area: ExamArea;
  selectedAnswer: string | null;
  correctAnswer: string;
};

export type AreaScore = { area: ExamArea; acertos: number; total: number };

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function pickBalancedByTopic(
  rows: { id: string; topicId: string }[],
  limit: number
): string[] {
  const byTopic = new Map<string, string[]>();
  for (const row of rows) {
    const list = byTopic.get(row.topicId) ?? [];
    list.push(row.id);
    byTopic.set(row.topicId, list);
  }
  const topicQueues = shuffle([...byTopic.values()]).map((ids) => shuffle(ids));

  const picked: string[] = [];
  let round = 0;
  while (picked.length < limit) {
    let addedThisRound = false;
    for (const queue of topicQueues) {
      if (picked.length >= limit) break;
      const id = queue[round];
      if (id) {
        picked.push(id);
        addedThisRound = true;
      }
    }
    if (!addedThisRound) break;
    round += 1;
  }
  return picked;
}

export async function pickFielQuestionIds(year: number, examDay: number): Promise<string[]> {
  const rows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      and(
        eq(questions.year, year),
        eq(questions.examDay, examDay),
        eq(questions.status, "aprovada")
      )
    )
    .orderBy(questions.questionNumber);
  return rows.map((r) => r.id);
}

export async function pickMescladoQuestionIds(examDay: 1 | 2): Promise<string[]> {
  const picked: string[] = [];
  for (const area of DAY_AREAS[examDay]) {
    const rows = await db
      .select({ id: questions.id, topicId: questions.topicId })
      .from(questions)
      .where(
        and(
          eq(questions.area, area),
          eq(questions.status, "aprovada"),
          ne(questions.correctAnswer, "Anulado")
        )
      );
    const areaPicked = pickBalancedByTopic(rows, QUESTIONS_PER_AREA);
    if (areaPicked.length < QUESTIONS_PER_AREA) {
      throw new Error(
        `Pool insuficiente para montar o simulado mesclado: área ${area} tem apenas ${areaPicked.length}/${QUESTIONS_PER_AREA} questões aprovadas`
      );
    }
    picked.push(...areaPicked);
  }
  return picked;
}

export function deriveFielAvailability(
  rows: { year: number; examDay: number; aprovadas: number }[]
): FielAvailability[] {
  return rows.map((row) => ({
    ...row,
    necessarias: FIEL_REQUIRED,
    disponivel: row.aprovadas === FIEL_REQUIRED,
  }));
}

export function deriveMescladoAvailability(
  counts: { area: ExamArea; aprovadas: number }[]
): MescladoAvailability[] {
  return ([1, 2] as const).map((examDay) => {
    const areas = DAY_AREAS[examDay].map((area) => {
      const found = counts.find((c) => c.area === area);
      return { area, aprovadas: found?.aprovadas ?? 0, necessarias: QUESTIONS_PER_AREA };
    });
    return { examDay, areas, disponivel: areas.every((a) => a.aprovadas >= QUESTIONS_PER_AREA) };
  });
}

export async function getFielAvailability(): Promise<FielAvailability[]> {
  const rows = await db
    .select({ year: questions.year, examDay: questions.examDay, aprovadas: count(questions.id) })
    .from(questions)
    .where(eq(questions.status, "aprovada"))
    .groupBy(questions.year, questions.examDay);
  return deriveFielAvailability(rows);
}

export async function getMescladoAvailability(): Promise<MescladoAvailability[]> {
  const rows = await db
    .select({ area: questions.area, aprovadas: count(questions.id) })
    .from(questions)
    .where(and(eq(questions.status, "aprovada"), ne(questions.correctAnswer, "Anulado")))
    .groupBy(questions.area);
  return deriveMescladoAvailability(rows);
}

export function computeScoreByArea(items: ScoredQuestion[]): AreaScore[] {
  const byArea = new Map<ExamArea, { acertos: number; total: number }>();
  for (const item of items) {
    if (item.correctAnswer === "Anulado") continue;
    const entry = byArea.get(item.area) ?? { acertos: 0, total: 0 };
    entry.total += 1;
    if (item.selectedAnswer === item.correctAnswer) entry.acertos += 1;
    byArea.set(item.area, entry);
  }
  return [...byArea.entries()].map(([area, v]) => ({ area, ...v }));
}

export function computeOverallScore(items: ScoredQuestion[]): { acertos: number; total: number } {
  return computeScoreByArea(items).reduce(
    (acc, area) => ({ acertos: acc.acertos + area.acertos, total: acc.total + area.total }),
    { acertos: 0, total: 0 }
  );
}
