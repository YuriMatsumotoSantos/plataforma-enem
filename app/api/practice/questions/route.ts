import { and, eq, ne } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const topicId = url.searchParams.get("topicId") ?? "";

  const rows = await db
    .select({
      id: questions.id,
      year: questions.year,
      examDay: questions.examDay,
      questionNumber: questions.questionNumber,
      statement: questions.statement,
      alternatives: questions.alternatives,
      imageUrl: questions.imageUrl,
      topic: {
        id: topics.id,
        area: topics.area,
        subject: topics.subject,
        name: topics.name,
      },
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .where(
      and(
        eq(questions.topicId, topicId),
        eq(questions.status, "aprovada"),
        ne(questions.correctAnswer, "Anulado")
      )
    );

  return Response.json({ questions: rows });
}
