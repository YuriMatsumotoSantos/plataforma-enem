import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { simulados } from "@/db/schema";

const VALID_LETTERS = ["A", "B", "C", "D", "E"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const { questionId, selectedAnswer, markedForReview } = body as Record<string, unknown>;

  if (typeof questionId !== "string") {
    return Response.json({ error: "questionId é obrigatório" }, { status: 400 });
  }
  if (
    selectedAnswer !== undefined &&
    selectedAnswer !== null &&
    !VALID_LETTERS.some((l) => l === selectedAnswer)
  ) {
    return Response.json({ error: "selectedAnswer inválido" }, { status: 400 });
  }
  if (markedForReview !== undefined && typeof markedForReview !== "boolean") {
    return Response.json({ error: "markedForReview inválido" }, { status: 400 });
  }

  const [simulado] = await db.select().from(simulados).where(eq(simulados.id, id));
  if (!simulado || simulado.userId !== session.user.id) {
    return Response.json({ error: "Simulado não encontrado" }, { status: 404 });
  }
  if (simulado.status !== "em_andamento") {
    return Response.json({ error: "Este simulado já foi finalizado" }, { status: 400 });
  }
  if (!simulado.questionIds.includes(questionId)) {
    return Response.json({ error: "Questão não faz parte deste simulado" }, { status: 400 });
  }

  const current = simulado.answers[questionId] ?? { selectedAnswer: null, markedForReview: false };
  const updated = {
    selectedAnswer:
      selectedAnswer === undefined ? current.selectedAnswer : (selectedAnswer as string | null),
    markedForReview: markedForReview === undefined ? current.markedForReview : markedForReview,
  };

  await db
    .update(simulados)
    .set({ answers: { ...simulado.answers, [questionId]: updated } })
    .where(eq(simulados.id, id));

  return Response.json({ ok: true });
}
