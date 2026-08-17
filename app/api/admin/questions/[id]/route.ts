import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { questions } from "@/db/schema";

const VALID_STATUSES = ["pendente", "aprovada", "rejeitada"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin(request);
  if (!session) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  // Validate status if present in body
  if (body && typeof body === "object" && "status" in body) {
    const status = (body as Record<string, unknown>).status;
    if (!VALID_STATUSES.includes(status as any)) {
      return Response.json({ error: "Status inválido" }, { status: 400 });
    }
  }

  const allowedFields = ["status", "statement", "alternatives", "correctAnswer", "topicId"] as const;
  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in (body as Record<string, unknown>)) {
      updates[field] = (body as Record<string, unknown>)[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
  }

  const [updated] = await db
    .update(questions)
    .set(updates)
    .where(eq(questions.id, id))
    .returning();

  if (!updated) {
    return Response.json({ error: "Questão não encontrada" }, { status: 404 });
  }

  return Response.json(updated);
}
