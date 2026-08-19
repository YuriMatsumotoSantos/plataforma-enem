import { desc, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { questions, simulados } from "@/db/schema";
import {
  DAY_DURATIONS,
  computeOverallScore,
  getFielAvailability,
  getMescladoAvailability,
  pickFielQuestionIds,
  pickMescladoQuestionIds,
} from "@/lib/simulados";

const VALID_MODES = ["mesclado", "fiel"] as const;
const VALID_DAYS = [1, 2] as const;

export async function POST(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const { mode, examDay, examYear } = body as Record<string, unknown>;

  if (!VALID_MODES.some((m) => m === mode)) {
    return Response.json({ error: "mode inválido" }, { status: 400 });
  }
  if (!VALID_DAYS.some((d) => d === examDay)) {
    return Response.json({ error: "examDay inválido" }, { status: 400 });
  }
  const day = examDay as 1 | 2;

  if (mode === "fiel") {
    if (typeof examYear !== "number") {
      return Response.json({ error: "examYear é obrigatório para o modo fiel" }, { status: 400 });
    }
    const availability = await getFielAvailability();
    const match = availability.find((a) => a.year === examYear && a.examDay === day);
    if (!match || !match.disponivel) {
      return Response.json(
        { error: "Este simulado fiel ainda não está disponível" },
        { status: 400 }
      );
    }
    const questionIds = await pickFielQuestionIds(examYear, day);
    const [created] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId: session.user.id,
        mode: "fiel",
        examDay: day,
        examYear,
        questionIds,
        durationSeconds: DAY_DURATIONS[day],
      })
      .returning({ id: simulados.id });
    return Response.json({ id: created.id });
  }

  const availability = await getMescladoAvailability();
  const match = availability.find((a) => a.examDay === day);
  if (!match || !match.disponivel) {
    return Response.json(
      { error: "Este simulado mesclado ainda não está disponível" },
      { status: 400 }
    );
  }
  const questionIds = await pickMescladoQuestionIds(day);
  const [created] = await db
    .insert(simulados)
    .values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      mode: "mesclado",
      examDay: day,
      questionIds,
      durationSeconds: DAY_DURATIONS[day],
    })
    .returning({ id: simulados.id });
  return Response.json({ id: created.id });
}

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(simulados)
    .where(eq(simulados.userId, session.user.id))
    .orderBy(desc(simulados.startedAt));

  const history = await Promise.all(
    rows.map(async (row) => {
      let score: { acertos: number; total: number } | null = null;
      if (row.status === "finalizado") {
        const questionRows = await db
          .select({ id: questions.id, area: questions.area, correctAnswer: questions.correctAnswer })
          .from(questions)
          .where(inArray(questions.id, row.questionIds));
        score = computeOverallScore(
          questionRows.map((q) => ({
            area: q.area,
            correctAnswer: q.correctAnswer,
            selectedAnswer: row.answers[q.id]?.selectedAnswer ?? null,
          }))
        );
      }
      return {
        id: row.id,
        mode: row.mode,
        examDay: row.examDay,
        examYear: row.examYear,
        status: row.status,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        score,
      };
    })
  );

  return Response.json({ simulados: history });
}
