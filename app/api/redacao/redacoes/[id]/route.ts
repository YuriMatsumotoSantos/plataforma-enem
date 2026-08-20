import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { redacoes } from "@/db/schema";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;

  const [redacao] = await db
    .select()
    .from(redacoes)
    .where(and(eq(redacoes.id, id), eq(redacoes.userId, session.user.id)));

  if (!redacao) {
    return Response.json({ error: "Redação não encontrada" }, { status: 404 });
  }

  return Response.json(redacao);
}
