import { Rating, State, createEmptyCard, type Card, type Grade } from "ts-fsrs";

export const WEAK_DIFFICULTY_THRESHOLD = 6;

export type TopicProgressRow = {
  stability: number;
  difficulty: number;
  state: number;
  lapses: number;
  reps: number;
  dueAt: Date;
  lastReviewedAt: Date;
};

export type TopicProgressUpdate = {
  stability: number;
  difficulty: number;
  state: number;
  lapses: number;
  reps: number;
  dueAt: Date;
  lastReviewedAt: Date;
};

export function gradeFromAccuracy(correct: number, total: number): Grade {
  const pct = correct / total;
  if (pct >= 1) return Rating.Easy;
  if (pct >= 0.7) return Rating.Good;
  if (pct >= 0.4) return Rating.Hard;
  return Rating.Again;
}

// elapsed_days / scheduled_days / learning_steps aren't persisted in
// topic_progress: this project's reviews are coarse, on-demand batch
// updates (whole practice sessions), never the same-day multi-step
// "Learning" ramp real Anki uses — zeroing them here is a no-op for how
// this app calls next(), not data loss.
export function cardFromProgress(row: TopicProgressRow | null): Card {
  if (!row) return createEmptyCard();
  return {
    due: row.dueAt,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.lastReviewedAt,
  };
}

export function progressFromCard(card: Card): TopicProgressUpdate {
  if (!card.last_review) {
    throw new Error("progressFromCard: card.last_review ausente (card nunca revisado)");
  }
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    state: card.state,
    lapses: card.lapses,
    reps: card.reps,
    dueAt: card.due,
    lastReviewedAt: card.last_review,
  };
}
