import { and, count, eq, ne } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const subject = url.searchParams.get("subject") ?? "";

  const rows = await db
    .select({
      id: topics.id,
      name: topics.name,
      count: count(questions.id),
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .where(
      and(
        eq(topics.subject, subject),
        eq(questions.status, "aprovada"),
        ne(questions.correctAnswer, "Anulado")
      )
    )
    .groupBy(topics.id, topics.name);

  return Response.json({ topics: rows });
}
