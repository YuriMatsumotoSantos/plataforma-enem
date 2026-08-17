import { and, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { questions, topics, type Alternative } from "@/db/schema";

export async function GET(request: Request) {
  const session = await requireAdmin(request);
  if (!session) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pendente";
  const area = url.searchParams.get("area");

  const conditions = [eq(questions.status, status as "pendente" | "aprovada" | "rejeitada")];
  if (area) {
    conditions.push(eq(questions.area, area as "linguagens" | "humanas" | "natureza" | "matematica"));
  }

  const rows = await db
    .select({
      id: questions.id,
      year: questions.year,
      examDay: questions.examDay,
      questionNumber: questions.questionNumber,
      area: questions.area,
      statement: questions.statement,
      alternatives: questions.alternatives,
      correctAnswer: questions.correctAnswer,
      imageUrl: questions.imageUrl,
      status: questions.status,
      topic: { id: topics.id, area: topics.area, subject: topics.subject, name: topics.name },
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .where(and(...conditions));

  return Response.json({ questions: rows });
}
