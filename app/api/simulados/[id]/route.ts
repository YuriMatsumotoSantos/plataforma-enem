import { eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { questions, simulados, topics } from "@/db/schema";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;

  const [simulado] = await db.select().from(simulados).where(eq(simulados.id, id));
  if (!simulado || simulado.userId !== session.user.id) {
    return Response.json({ error: "Simulado não encontrado" }, { status: 404 });
  }

  const questionRows = await db
    .select({
      id: questions.id,
      area: questions.area,
      statement: questions.statement,
      alternatives: questions.alternatives,
      imageUrl: questions.imageUrl,
      topic: { id: topics.id, name: topics.name },
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .where(inArray(questions.id, simulado.questionIds));

  const byId = new Map(questionRows.map((q) => [q.id, q]));
  const orderedQuestions = simulado.questionIds
    .map((qid) => byId.get(qid))
    .filter((q): q is NonNullable<typeof q> => q !== undefined);

  return Response.json({
    id: simulado.id,
    mode: simulado.mode,
    examDay: simulado.examDay,
    examYear: simulado.examYear,
    status: simulado.status,
    startedAt: simulado.startedAt,
    durationSeconds: simulado.durationSeconds,
    answers: simulado.answers,
    questions: orderedQuestions,
  });
}
