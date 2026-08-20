import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { redacoes, temas } from "@/db/schema";
import { gradeRedacao } from "@/lib/redacao";

const MIN_WORDS = 50;
const MAX_CHARS = 3000;

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

  const { temaId, text } = body as Record<string, unknown>;

  if (typeof temaId !== "string" || typeof text !== "string") {
    return Response.json({ error: "temaId e text são obrigatórios" }, { status: 400 });
  }

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_WORDS) {
    return Response.json(
      { error: `O texto precisa ter pelo menos ${MIN_WORDS} palavras` },
      { status: 400 }
    );
  }
  if (text.length > MAX_CHARS) {
    return Response.json(
      { error: `O texto não pode passar de ${MAX_CHARS} caracteres` },
      { status: 400 }
    );
  }

  const [tema] = await db.select().from(temas).where(eq(temas.id, temaId));
  if (!tema) {
    return Response.json({ error: "Tema não encontrado" }, { status: 400 });
  }

  let graded: Awaited<ReturnType<typeof gradeRedacao>>;
  try {
    graded = await gradeRedacao(tema.title, text);
  } catch {
    return Response.json({ error: "Falha ao corrigir a redação. Tente novamente." }, { status: 502 });
  }

  const [saved] = await db
    .insert(redacoes)
    .values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      temaId: tema.id,
      text,
      scores: graded.scores,
      notaTotal: graded.notaTotal,
      feedback: graded.feedback,
    })
    .returning();

  return Response.json(saved);
}
