import { and, eq, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { questions } from "@/db/schema";

export async function questionAlreadyExists(
  year: number,
  examDay: number,
  questionNumber: number
): Promise<boolean> {
  const [existing] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      and(
        eq(questions.year, year),
        eq(questions.examDay, examDay),
        eq(questions.questionNumber, questionNumber)
      )
    )
    .limit(1);

  return existing !== undefined;
}

export async function countExistingQuestions(
  year: number,
  examDay: number
): Promise<number> {
  const [result] = await db
    .select({ total: count() })
    .from(questions)
    .where(
      and(
        eq(questions.year, year),
        eq(questions.examDay, examDay)
      )
    );

  return result?.total ?? 0;
}
