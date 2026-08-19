import { eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { attempts, questions, simulados } from "@/db/schema";

export async function POST(
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
  if (simulado.status !== "em_andamento") {
    return Response.json({ error: "Este simulado já foi finalizado" }, { status: 400 });
  }

  const answeredIds = Object.entries(simulado.answers)
    .filter(([, a]) => a.selectedAnswer !== null)
    .map(([questionId]) => questionId);

  if (answeredIds.length > 0) {
    const answeredQuestions = await db
      .select({ id: questions.id, correctAnswer: questions.correctAnswer })
      .from(questions)
      .where(inArray(questions.id, answeredIds));

    const attemptRows = answeredQuestions
      .filter((q) => q.correctAnswer !== "Anulado")
      .map((q) => ({
        id: crypto.randomUUID(),
        questionId: q.id,
        userId: session.user.id,
        selectedAnswer: simulado.answers[q.id].selectedAnswer as string,
        isCorrect: simulado.answers[q.id].selectedAnswer === q.correctAnswer,
      }));

    if (attemptRows.length > 0) {
      await db.insert(attempts).values(attemptRows);
    }
  }

  await db
    .update(simulados)
    .set({ status: "finalizado", finishedAt: new Date() })
    .where(eq(simulados.id, id));

  return Response.json({ ok: true });
}
