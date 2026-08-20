import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { fsrs } from "ts-fsrs";
import { db } from "@/lib/db";
import { attempts, questions, topicProgress, type TopicProgress } from "@/db/schema";
import { cardFromProgress, gradeFromAccuracy, progressFromCard, type TopicProgressUpdate } from "@/lib/fsrs";

const scheduler = fsrs();

// Shared by the single-topic path (getOrUpdateTopicProgress) and the batched
// path (recomputeAllPending): derives the next FSRS card state from the
// existing progress row (or a fresh card, if this topic has never been
// reviewed) plus the batch of newly-seen attempts.
function computeNextProgress(
  existing: TopicProgress | null,
  newAttempts: { isCorrect: boolean }[],
  now: Date
): TopicProgressUpdate {
  const correct = newAttempts.filter((a) => a.isCorrect).length;
  const grade = gradeFromAccuracy(correct, newAttempts.length);
  const { card: nextCard } = scheduler.next(cardFromProgress(existing), now, grade);
  return progressFromCard(nextCard);
}

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
  // dbNow is read off the same query as the attempts it gates future
  // recomputes against, instead of an app-side `new Date()`. attempts.createdAt
  // is a Postgres-clock value (defaultNow()); this local dev DB and the Node
  // process run on different clocks a few ms apart, so comparing a Postgres
  // timestamp against an app-clock one can flip order at that margin and
  // either lose an attempt or double-count it. Reading now() from Postgres
  // here also closes the race where an attempt inserted between this SELECT
  // and the write below would otherwise get lost forever (its createdAt would
  // land before the lastReviewedAt this call is about to persist).
  const newAttempts = await db
    .select({ isCorrect: attempts.isCorrect, dbNow: sql<string>`now()` })
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

  const now = new Date(newAttempts[0].dbNow);
  const progress = computeNextProgress(existing ?? null, newAttempts, now);

  if (!existing) {
    // Two near-simultaneous first-ever reviews of the same (userId, topicId)
    // (e.g. two open tabs) could both reach this insert; the unique constraint
    // on that pair would make the loser throw. onConflictDoNothing + re-select
    // absorbs the loser instead: it just reads back whichever row won.
    const [inserted] = await db
      .insert(topicProgress)
      .values({ id: crypto.randomUUID(), userId, topicId, ...progress })
      .onConflictDoNothing({ target: [topicProgress.userId, topicProgress.topicId] })
      .returning();
    if (inserted) return inserted;

    const [winner] = await db
      .select()
      .from(topicProgress)
      .where(and(eq(topicProgress.userId, userId), eq(topicProgress.topicId, topicId)));
    return winner ?? null;
  }

  const updated = await applyProgressUpdate(existing.id, existing.lastReviewedAt, progress);
  return updated ?? existing;
}

export async function recomputeAllPending(userId: string): Promise<void> {
  const topicIds = await getTopicsNeedingRecompute(userId);
  if (topicIds.length === 0) return;

  // Batches the reads that getOrUpdateTopicProgress would otherwise do once
  // per topic (2 queries x N topics -> 2 queries total). Writes stay one per
  // topic below: they're correctness-sensitive (optimistic-concurrency guard
  // in applyProgressUpdate), so they aren't batched into a single statement.
  const existingRows = await db
    .select()
    .from(topicProgress)
    .where(and(eq(topicProgress.userId, userId), inArray(topicProgress.topicId, topicIds)));
  const existingByTopic = new Map(existingRows.map((row) => [row.topicId, row]));

  // dbNow is read off the same query as the attempts (see getOrUpdateTopicProgress
  // for why: it keeps the "since" cutoff on the same Postgres clock as
  // attempts.createdAt, instead of racing an app-side `new Date()` against it).
  // topicIds is non-empty here and every entry came from
  // getTopicsNeedingRecompute, which only returns topics with at least one
  // qualifying attempt, so this query always returns at least one row.
  const attemptRows = await db
    .select({
      topicId: questions.topicId,
      isCorrect: attempts.isCorrect,
      createdAt: attempts.createdAt,
      dbNow: sql<string>`now()`,
    })
    .from(attempts)
    .innerJoin(questions, eq(questions.id, attempts.questionId))
    .where(and(eq(attempts.userId, userId), inArray(questions.topicId, topicIds)));

  // Asserted rather than falling back to `new Date()`: a silent fallback here
  // would reintroduce the exact Node/Postgres clock-skew bug this function's
  // Postgres-sourced `now` exists to avoid, with nothing to catch it if a
  // future change ever violates the invariant above.
  if (attemptRows.length === 0) {
    throw new Error(
      "recomputeAllPending: attemptRows vazio para topicIds vindos de getTopicsNeedingRecompute — invariante violado"
    );
  }
  const now = new Date(attemptRows[0].dbNow);

  const attemptsByTopic = new Map<string, { isCorrect: boolean; createdAt: Date }[]>();
  for (const row of attemptRows) {
    const list = attemptsByTopic.get(row.topicId);
    if (list) {
      list.push(row);
    } else {
      attemptsByTopic.set(row.topicId, [row]);
    }
  }

  for (const topicId of topicIds) {
    const existing = existingByTopic.get(topicId) ?? null;
    const since = existing?.lastReviewedAt ?? new Date(0);
    const newAttempts = (attemptsByTopic.get(topicId) ?? []).filter((a) => a.createdAt > since);
    if (newAttempts.length === 0) continue;

    const progress = computeNextProgress(existing, newAttempts, now);

    if (!existing) {
      // Same onConflictDoNothing + re-select race guard as getOrUpdateTopicProgress
      // above; if we lose the race, the winner's row is already correct.
      await db
        .insert(topicProgress)
        .values({ id: crypto.randomUUID(), userId, topicId, ...progress })
        .onConflictDoNothing({ target: [topicProgress.userId, topicProgress.topicId] });
      continue;
    }

    await applyProgressUpdate(existing.id, existing.lastReviewedAt, progress);
  }
}
