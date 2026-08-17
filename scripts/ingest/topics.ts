import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { topics } from "@/db/schema";

export async function findOrCreateTopic(
  area: "linguagens" | "humanas" | "natureza" | "matematica",
  subject: string,
  name: string
): Promise<string> {
  const [existing] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.area, area), eq(topics.subject, subject), eq(topics.name, name)))
    .limit(1);

  if (existing) {
    return existing.id;
  }

  const [created] = await db
    .insert(topics)
    .values({ id: crypto.randomUUID(), area, subject, name })
    .returning({ id: topics.id });

  return created.id;
}
