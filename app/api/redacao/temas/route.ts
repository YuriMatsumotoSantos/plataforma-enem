import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { temas } from "@/db/schema";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const rows = await db.select({ id: temas.id, title: temas.title }).from(temas);
  return Response.json({ temas: rows });
}
