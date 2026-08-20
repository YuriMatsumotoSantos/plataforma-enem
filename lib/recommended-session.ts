import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { questions, topicProgress, topics, type Alternative } from "@/db/schema";
import { getTopicProgressRows, selectFracos, selectVencidos } from "@/lib/dashboard";

const MAX_TOPICS = 5;
const RECOMMENDED_POOL_SIZE = 20;

export type CandidateTopic = {
  topicId: string;
  subject: string;
  area: string;
  name: string;
};

export type PracticeQuestion = {
  id: string;
  year: number;
  examDay: number;
  questionNumber: number;
  statement: string;
  alternatives: Alternative[];
  imageUrl: string | null;
  topic: { id: string; area: string; subject: string; name: string };
};

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function selectRecommendedTopics(
  vencidos: CandidateTopic[],
  fracos: CandidateTopic[],
  neverAttempted: CandidateTopic[],
  limit: number = MAX_TOPICS
): CandidateTopic[] {
  const picked: CandidateTopic[] = [];
  const pickedIds = new Set<string>();

  for (const source of [vencidos, fracos, neverAttempted]) {
    for (const topic of source) {
      if (picked.length >= limit) break;
      if (pickedIds.has(topic.topicId)) continue;
      picked.push(topic);
      pickedIds.add(topic.topicId);
    }
  }
  return picked;
}

export async function getNeverAttemptedTopics(userId: string): Promise<CandidateTopic[]> {
  const rows = await db
    .selectDistinct({
      topicId: topics.id,
      subject: topics.subject,
      area: topics.area,
      name: topics.name,
    })
    .from(topics)
    .innerJoin(questions, eq(questions.topicId, topics.id))
    .leftJoin(
      topicProgress,
      and(eq(topicProgress.topicId, topics.id), eq(topicProgress.userId, userId))
    )
    .where(
      and(
        eq(questions.status, "aprovada"),
        ne(questions.correctAnswer, "Anulado"),
        isNull(topicProgress.id)
      )
    );
  return rows;
}

export async function getRecommendedQuestionPool(topicIds: string[]): Promise<PracticeQuestion[]> {
  if (topicIds.length === 0) return [];
  const rows = await db
    .select({
      id: questions.id,
      year: questions.year,
      examDay: questions.examDay,
      questionNumber: questions.questionNumber,
      statement: questions.statement,
      alternatives: questions.alternatives,
      imageUrl: questions.imageUrl,
      topic: { id: topics.id, area: topics.area, subject: topics.subject, name: topics.name },
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .where(
      and(
        inArray(questions.topicId, topicIds),
        eq(questions.status, "aprovada"),
        ne(questions.correctAnswer, "Anulado")
      )
    );
  return shuffle(rows).slice(0, RECOMMENDED_POOL_SIZE);
}

export async function getRecommendedSession(userId: string) {
  const rows = await getTopicProgressRows(userId);
  const now = new Date();
  const vencidos = selectVencidos(rows, now);
  const fracos = selectFracos(rows);
  const needed = MAX_TOPICS - vencidos.length - fracos.length;
  const neverAttempted = needed > 0 ? shuffle(await getNeverAttemptedTopics(userId)) : [];

  // Named selectedTopics/poolQuestions, not topics/questions, so they don't
  // shadow the schema table imports of the same name used above in this file.
  const selectedTopics = selectRecommendedTopics(vencidos, fracos, neverAttempted);
  const poolQuestions = await getRecommendedQuestionPool(selectedTopics.map((t) => t.topicId));

  return { topics: selectedTopics, questions: poolQuestions };
}
