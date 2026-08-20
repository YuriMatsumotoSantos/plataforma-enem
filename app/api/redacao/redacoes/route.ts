import { count, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { redacoes, temas } from "@/db/schema";
import { gradeRedacao } from "@/lib/redacao";

const MIN_WORDS = 50;
const MAX_CHARS = 3000;
const PAGE_SIZE = 20;

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

function parsePage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) {
    return 1;
  }
  const parsed = Number(value);
  return parsed >= 1 ? parsed : 1;
}

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const page = parsePage(url.searchParams.get("page"));

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(redacoes)
    .where(eq(redacoes.userId, session.user.id));

  const rows = await db
    .select({
      id: redacoes.id,
      temaId: redacoes.temaId,
      temaTitle: temas.title,
      notaTotal: redacoes.notaTotal,
      createdAt: redacoes.createdAt,
    })
    .from(redacoes)
    .innerJoin(temas, eq(redacoes.temaId, temas.id))
    .where(eq(redacoes.userId, session.user.id))
    .orderBy(desc(redacoes.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return Response.json({ redacoes: rows, page, pageSize: PAGE_SIZE, total });
}
