import { describe, it, expect } from "vitest";
import { Rating, State, createEmptyCard, fsrs } from "ts-fsrs";
import { gradeFromAccuracy, cardFromProgress, progressFromCard } from "@/lib/fsrs";

describe("gradeFromAccuracy", () => {
  it("100% de acerto vira Easy", () => {
    expect(gradeFromAccuracy(5, 5)).toBe(Rating.Easy);
  });
  it(">=70% e <100% vira Good", () => {
    expect(gradeFromAccuracy(7, 10)).toBe(Rating.Good);
  });
  it(">=40% e <70% vira Hard", () => {
    expect(gradeFromAccuracy(4, 10)).toBe(Rating.Hard);
  });
  it("<40% vira Again", () => {
    expect(gradeFromAccuracy(3, 10)).toBe(Rating.Again);
  });
});

describe("cardFromProgress", () => {
  it("sem progresso existente, devolve um card novo (state New)", () => {
    const card = cardFromProgress(null);
    expect(card.state).toBe(State.New);
  });

  it("com progresso existente, reconstrói os campos persistidos", () => {
    const dueAt = new Date("2026-09-01T00:00:00Z");
    const lastReviewedAt = new Date("2026-08-20T00:00:00Z");
    const card = cardFromProgress({
      stability: 3.2,
      difficulty: 5.5,
      state: State.Review,
      lapses: 1,
      reps: 4,
      dueAt,
      lastReviewedAt,
    });
    expect(card.stability).toBeCloseTo(3.2);
    expect(card.difficulty).toBeCloseTo(5.5);
    expect(card.state).toBe(State.Review);
    expect(card.lapses).toBe(1);
    expect(card.reps).toBe(4);
    expect(card.due).toEqual(dueAt);
    expect(card.last_review).toEqual(lastReviewedAt);
  });
});

describe("progressFromCard", () => {
  it("extrai os campos persistidos de um card já revisado", () => {
    const scheduler = fsrs();
    const now = new Date("2026-08-20T12:00:00Z");
    const { card } = scheduler.next(createEmptyCard(now), now, Rating.Good);

    const progress = progressFromCard(card);

    expect(progress.stability).toBe(card.stability);
    expect(progress.difficulty).toBe(card.difficulty);
    expect(progress.state).toBe(card.state);
    expect(progress.lapses).toBe(card.lapses);
    expect(progress.reps).toBe(card.reps);
    expect(progress.dueAt).toEqual(card.due);
    expect(progress.lastReviewedAt).toEqual(card.last_review);
  });

  it("lança erro se o card não tem last_review (nunca foi revisado)", () => {
    const card = createEmptyCard();
    expect(() => progressFromCard(card)).toThrow();
  });
});
