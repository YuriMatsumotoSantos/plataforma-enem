import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";

const VALID_STATUSES = ["pendente", "aprovada", "rejeitada"] as const;
const VALID_LETTERS = ["A", "B", "C", "D", "E"] as const;

function isValidAlternatives(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 5) {
    return false;
  }

  const letters = new Set<string>();
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as Record<string, unknown>).letter !== "string" ||
      typeof (item as Record<string, unknown>).text !== "string"
    ) {
      return false;
    }
    letters.add((item as { letter: string }).letter);
  }

  return VALID_LETTERS.every((letter) => letters.has(letter)) && letters.size === 5;
}

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

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const bodyRecord = body as Record<string, unknown>;

  // Validate status if present in body
  if ("status" in bodyRecord) {
    const status = bodyRecord.status;
    if (!VALID_STATUSES.some((s) => s === status)) {
      return Response.json({ error: "Status inválido" }, { status: 400 });
    }
  }

  // Alternativas sempre exatamente 5 (A-E), guardadas juntas em JSONB.
  if ("alternatives" in bodyRecord && !isValidAlternatives(bodyRecord.alternatives)) {
    return Response.json(
      { error: "Alternativas devem ter exatamente 5 itens (A-E)" },
      { status: 400 }
    );
  }

  // Validate statement and correctAnswer must be strings if present
  if ("statement" in bodyRecord && typeof bodyRecord.statement !== "string") {
    return Response.json(
      { error: "Campo inválido: statement e correctAnswer devem ser texto" },
      { status: 400 }
    );
  }

  if ("correctAnswer" in bodyRecord && typeof bodyRecord.correctAnswer !== "string") {
    return Response.json(
      { error: "Campo inválido: statement e correctAnswer devem ser texto" },
      { status: 400 }
    );
  }

  if ("topicId" in bodyRecord) {
    const topicId = bodyRecord.topicId;
    if (typeof topicId !== "string") {
      return Response.json({ error: "topicId não encontrado" }, { status: 404 });
    }
    const [existingTopic] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.id, topicId));
    if (!existingTopic) {
      return Response.json({ error: "topicId não encontrado" }, { status: 404 });
    }
  }

  const allowedFields = ["status", "statement", "alternatives", "correctAnswer", "topicId"] as const;
  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in bodyRecord) {
      updates[field] = bodyRecord[field];
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
