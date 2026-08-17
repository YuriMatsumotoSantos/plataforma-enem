import { asc } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { topics } from "@/db/schema";

export async function GET(request: Request) {
  const session = await requireAdmin(request);
  if (!session) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  const rows = await db
    .select({ id: topics.id, area: topics.area, subject: topics.subject, name: topics.name })
    .from(topics)
    .orderBy(asc(topics.subject), asc(topics.name));

  return Response.json({ topics: rows });
}
