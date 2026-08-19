import { and, count, eq, ne } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const rows = await db
    .select({
      subject: topics.subject,
      area: topics.area,
      count: count(questions.id),
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .where(and(eq(questions.status, "aprovada"), ne(questions.correctAnswer, "Anulado")))
    .groupBy(topics.subject, topics.area);

  return Response.json({ subjects: rows });
}
