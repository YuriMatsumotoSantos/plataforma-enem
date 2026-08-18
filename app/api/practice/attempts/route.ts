import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { attempts, questions } from "@/db/schema";

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

  const { questionId, selectedAnswer } = body as Record<string, unknown>;

  if (typeof questionId !== "string" || typeof selectedAnswer !== "string") {
    return Response.json(
      { error: "questionId e selectedAnswer são obrigatórios" },
      { status: 400 }
    );
  }

  const [question] = await db
    .select({ correctAnswer: questions.correctAnswer })
    .from(questions)
    .where(eq(questions.id, questionId));

  if (!question) {
    return Response.json({ error: "Questão não encontrada" }, { status: 404 });
  }

  const isCorrect = selectedAnswer === question.correctAnswer;

  await db.insert(attempts).values({
    id: crypto.randomUUID(),
    questionId,
    userId: session.user.id,
    selectedAnswer,
    isCorrect,
  });

  return Response.json({ isCorrect, correctAnswer: question.correctAnswer });
}
