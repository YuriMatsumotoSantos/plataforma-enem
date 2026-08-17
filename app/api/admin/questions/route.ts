import { and, count, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";

const VALID_STATUSES = ["pendente", "aprovada", "rejeitada"] as const;
const VALID_AREAS = ["linguagens", "humanas", "natureza", "matematica"] as const;
const PAGE_SIZE = 20;

function isValidStatus(value: string): value is (typeof VALID_STATUSES)[number] {
  return VALID_STATUSES.some((s) => s === value);
}

function isValidArea(value: string): value is (typeof VALID_AREAS)[number] {
  return VALID_AREAS.some((a) => a === value);
}

function parsePage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) {
    return 1;
  }
  const parsed = Number(value);
  return parsed >= 1 ? parsed : 1;
}

export async function GET(request: Request) {
  const session = await requireAdmin(request);
  if (!session) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pendente";
  const area = url.searchParams.get("area");
  const page = parsePage(url.searchParams.get("page"));

  if (!isValidStatus(status)) {
    return Response.json({ error: "Status inválido" }, { status: 400 });
  }

  if (area && !isValidArea(area)) {
    return Response.json({ error: "Área inválida" }, { status: 400 });
  }

  const conditions = [eq(questions.status, status)];
  if (area) {
    conditions.push(eq(questions.area, area as "linguagens" | "humanas" | "natureza" | "matematica"));
  }

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(questions)
    .where(and(...conditions));

  const rows = await db
    .select({
      id: questions.id,
      year: questions.year,
      examDay: questions.examDay,
      questionNumber: questions.questionNumber,
      area: questions.area,
      statement: questions.statement,
      alternatives: questions.alternatives,
      correctAnswer: questions.correctAnswer,
      imageUrl: questions.imageUrl,
      status: questions.status,
      topic: { id: topics.id, area: topics.area, subject: topics.subject, name: topics.name },
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .where(and(...conditions))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return Response.json({ questions: rows, total, page, pageSize: PAGE_SIZE });
}
