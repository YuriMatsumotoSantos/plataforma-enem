import { eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { questions, simulados, topics } from "@/db/schema";
import { computeScoreByArea } from "@/lib/simulados";

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
  if (simulado.status !== "finalizado") {
    return Response.json({ error: "Este simulado ainda não foi finalizado" }, { status: 403 });
  }

  const questionRows = await db
    .select({
      id: questions.id,
      area: questions.area,
      statement: questions.statement,
      alternatives: questions.alternatives,
      correctAnswer: questions.correctAnswer,
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

  const scoreByArea = computeScoreByArea(
    orderedQuestions.map((q) => ({
      area: q.area,
      correctAnswer: q.correctAnswer,
      selectedAnswer: simulado.answers[q.id]?.selectedAnswer ?? null,
    }))
  );

  const review = orderedQuestions.map((q) => ({
    id: q.id,
    area: q.area,
    statement: q.statement,
    alternatives: q.alternatives,
    correctAnswer: q.correctAnswer,
    imageUrl: q.imageUrl,
    topic: q.topic,
    selectedAnswer: simulado.answers[q.id]?.selectedAnswer ?? null,
  }));

  return Response.json({ scoreByArea, questions: review });
}
