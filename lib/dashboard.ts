import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { topicProgress, topics } from "@/db/schema";
import { WEAK_DIFFICULTY_THRESHOLD } from "@/lib/fsrs";
import { recomputeAllPending } from "@/lib/topic-progress";

export type TopicProgressWithTopic = {
  topicId: string;
  subject: string;
  area: string;
  name: string;
  dueAt: Date;
  difficulty: number;
};

export function selectVencidos(
  rows: TopicProgressWithTopic[],
  now: Date
): TopicProgressWithTopic[] {
  return rows
    .filter((r) => r.dueAt <= now)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

export function selectFracos(rows: TopicProgressWithTopic[]): TopicProgressWithTopic[] {
  return rows
    .filter((r) => r.difficulty >= WEAK_DIFFICULTY_THRESHOLD)
    .sort((a, b) => b.difficulty - a.difficulty);
}

export async function getTopicProgressRows(userId: string): Promise<TopicProgressWithTopic[]> {
  await recomputeAllPending(userId);
  return db
    .select({
      topicId: topicProgress.topicId,
      subject: topics.subject,
      area: topics.area,
      name: topics.name,
      dueAt: topicProgress.dueAt,
      difficulty: topicProgress.difficulty,
    })
    .from(topicProgress)
    .innerJoin(topics, eq(topics.id, topicProgress.topicId))
    .where(eq(topicProgress.userId, userId));
}

export async function getDashboardData(userId: string) {
  const rows = await getTopicProgressRows(userId);
  const now = new Date();
  return { vencidos: selectVencidos(rows, now), fracos: selectFracos(rows) };
}
