import { and, eq, gt, isNull, or } from "drizzle-orm";
import { fsrs } from "ts-fsrs";
import { db } from "@/lib/db";
import { attempts, questions, topicProgress, type TopicProgress } from "@/db/schema";
import { cardFromProgress, gradeFromAccuracy, progressFromCard, type TopicProgressUpdate } from "@/lib/fsrs";

const scheduler = fsrs();

export async function getTopicsNeedingRecompute(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ topicId: questions.topicId })
    .from(attempts)
    .innerJoin(questions, eq(questions.id, attempts.questionId))
    .leftJoin(
      topicProgress,
      and(eq(topicProgress.topicId, questions.topicId), eq(topicProgress.userId, userId))
    )
    .where(
      and(
        eq(attempts.userId, userId),
        or(isNull(topicProgress.id), gt(attempts.createdAt, topicProgress.lastReviewedAt))
      )
    );
  return rows.map((r) => r.topicId);
}

export async function applyProgressUpdate(
  progressId: string,
  expectedLastReviewedAt: Date,
  progress: TopicProgressUpdate
): Promise<TopicProgress | undefined> {
  const [updated] = await db
    .update(topicProgress)
    .set(progress)
    .where(
      and(
        eq(topicProgress.id, progressId),
        eq(topicProgress.lastReviewedAt, expectedLastReviewedAt)
      )
    )
    .returning();
  return updated;
}

export async function getOrUpdateTopicProgress(
  userId: string,
  topicId: string
): Promise<TopicProgress | null> {
  const [existing] = await db
    .select()
    .from(topicProgress)
    .where(and(eq(topicProgress.userId, userId), eq(topicProgress.topicId, topicId)));

  const since = existing?.lastReviewedAt ?? new Date(0);
  const newAttempts = await db
    .select({ isCorrect: attempts.isCorrect })
    .from(attempts)
    .innerJoin(questions, eq(questions.id, attempts.questionId))
    .where(
      and(
        eq(attempts.userId, userId),
        eq(questions.topicId, topicId),
        gt(attempts.createdAt, since)
      )
    );

  if (newAttempts.length === 0) {
    return existing ?? null;
  }

  const correct = newAttempts.filter((a) => a.isCorrect).length;
  const grade = gradeFromAccuracy(correct, newAttempts.length);
  const now = new Date();
  const { card: nextCard } = scheduler.next(cardFromProgress(existing ?? null), now, grade);
  const progress = progressFromCard(nextCard);

  if (!existing) {
    const [inserted] = await db
      .insert(topicProgress)
      .values({ id: crypto.randomUUID(), userId, topicId, ...progress })
      .returning();
    return inserted;
  }

  const updated = await applyProgressUpdate(existing.id, existing.lastReviewedAt, progress);
  return updated ?? existing;
}

export async function recomputeAllPending(userId: string): Promise<void> {
  const topicIds = await getTopicsNeedingRecompute(userId);
  for (const topicId of topicIds) {
    await getOrUpdateTopicProgress(userId, topicId);
  }
}
