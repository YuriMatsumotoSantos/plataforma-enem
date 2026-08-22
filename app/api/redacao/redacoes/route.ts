import { count, desc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { redacoes, temas } from "@/db/schema";
import { gradeRedacao } from "@/lib/redacao";
import { canSubmitRedacao } from "@/lib/entitlements";

const MIN_WORDS = 50;
const MAX_CHARS = 3000;
const PAGE_SIZE = 20;

export const maxDuration = 60;

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

  // Gate check + chamada à IA + insert precisam ficar atômicos por usuário:
  // sem isso, duas requisições concorrentes (duplo clique, duas abas) podem
  // passar no check com a mesma contagem e disparar duas chamadas pagas à
  // IA antes que qualquer uma grave sua redação. Um advisory lock por
  // usuário serializa: a segunda requisição só roda o check depois que a
  // primeira já terminou sua transação (commit ou rollback).
  let limitReached = false;
  let saved: typeof redacoes.$inferSelect | undefined;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.user.id}))`);

      if (!(await canSubmitRedacao(session.user.id, tx))) {
        limitReached = true;
        return;
      }

      const graded = await gradeRedacao(tema.title, text);

      [saved] = await tx
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
    });
  } catch {
    return Response.json({ error: "Falha ao corrigir a redação. Tente novamente." }, { status: 502 });
  }

  if (limitReached) {
    return Response.json(
      { error: "Limite de correções do mês atingido. Assine o Premium para mais correções." },
      { status: 402 }
    );
  }

  return Response.json(saved);
}

function parsePage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) {
    return 1;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
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
