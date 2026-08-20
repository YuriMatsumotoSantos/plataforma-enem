# Dashboard + Recomendação Adaptativa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the `attempts` history already written by Prática por assunto (subsystem 3) and Simulados (subsystem 4) to power a `/dashboard` (assuntos vencidos + pontos fracos) and a `/pratica/recomendada` interleaved practice session, driven by a per-topic FSRS spaced-repetition state.

**Architecture:** A new `topic_progress` table holds one FSRS "card" per `(userId, topicId)`. A lazy, on-demand recompute function walks new `attempts` since the topic's last review, maps the batch's accuracy to an FSRS grade, and advances the card via the `ts-fsrs` library — no background job, same synchronous-request pattern as the rest of the project. Dashboard and recommended-session endpoints both trigger this recompute before reading `topic_progress`.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM / Postgres, `ts-fsrs` (new dependency), Vitest, existing `requireUser`/Better Auth session pattern.

## Global Constraints

- Every user-facing string is Portuguese — no English text (established project-wide rule, broken once by vendored shadcn defaults, always caught and fixed in review).
- No background jobs / cron / queues — every computation this subsystem needs must run synchronously inside the request that needs it (same pattern as every prior subsystem, most recently the sync Claude grading call in Redação).
- Interactive pages are Client Components fetching from API routes (`"use client"` + `useEffect`/`fetch`), not Server Components — matches `/pratica` and `/simulados` exactly.
- All new API routes require an authenticated session via the existing `requireUser(request)` helper (`lib/session.ts`) and return `401 { error: "Não autenticado" }` when absent.
- `topic_progress` is the only new table. `attempts`, `questions`, `topics` are read-only from this subsystem — no schema or route changes to subsystems 3/4.
- Local Postgres (Docker Compose, host port **5433**) must be running before `npm run db:generate`, `npm run db:migrate`, or `npm test` (DB-backed tests hit it directly).
- New dependency: `ts-fsrs` (`^5.4.1` at plan-writing time, 2026-08-20) — no API key, no config beyond the package's own defaults (`fsrs()` with no arguments).
- Any new route prefix needs an explicit entry in `middleware.ts`'s `config.matcher` array — `/pratica/:path*` already covers `/pratica/recomendada`, but `/dashboard` is new and needs its own entry (a subsystem 3 review caught this exact class of gap before, don't repeat it).
- Every new student-facing flow needs a nav entry point in `app/components/Header.tsx` before the subsystem is done (subsystem 3's first review found `/pratica` had none).
- README gets a new section for this subsystem before the subsystem is done (subsystem 3's `pr-audit` caught a missing README section as the one real gap before merge).

---

### Task 1: `topic_progress` schema

**Files:**
- Modify: `db/schema.ts` (append after the `attempts` table / `Attempt` type export)
- Test: `tests/schema-topic-progress.test.ts`

**Interfaces:**
- Produces: `topicProgress` pgTable export, `TopicProgress = typeof topicProgress.$inferSelect` type — every later task reads/writes through this table.

- [ ] **Step 1: Write the failing schema test**

Create `tests/schema-topic-progress.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { topicProgress, topics, user } from "@/db/schema";

async function createTopicAndUser() {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: "matematica",
      subject: "Matemática",
      name: "Álgebra",
    })
    .returning();

  const [testUser] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Aluno Teste",
      email: `aluno-${crypto.randomUUID()}@example.com`,
      emailVerified: false,
    })
    .returning();

  return { topic, testUser };
}

describe("schema de topic_progress", () => {
  it("cria um topic_progress referenciando um topic e um user reais", async () => {
    const { topic, testUser } = await createTopicAndUser();
    const now = new Date();

    const [row] = await db
      .insert(topicProgress)
      .values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        topicId: topic.id,
        stability: 1.5,
        difficulty: 5,
        state: 1,
        lapses: 0,
        reps: 1,
        dueAt: now,
        lastReviewedAt: now,
      })
      .returning();

    expect(row.topicId).toBe(topic.id);
    expect(row.userId).toBe(testUser.id);
    expect(row.stability).toBeCloseTo(1.5);
    expect(row.state).toBe(1);
  });

  it("rejeita topicId inexistente", async () => {
    const { testUser } = await createTopicAndUser();
    const now = new Date();

    await expect(
      db.insert(topicProgress).values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        topicId: crypto.randomUUID(),
        stability: 1,
        difficulty: 1,
        state: 0,
        lapses: 0,
        reps: 0,
        dueAt: now,
        lastReviewedAt: now,
      })
    ).rejects.toThrow();
  });

  it("rejeita um segundo topic_progress para o mesmo (userId, topicId)", async () => {
    const { topic, testUser } = await createTopicAndUser();
    const now = new Date();
    const values = {
      userId: testUser.id,
      topicId: topic.id,
      stability: 1,
      difficulty: 1,
      state: 0,
      lapses: 0,
      reps: 0,
      dueAt: now,
      lastReviewedAt: now,
    };

    await db.insert(topicProgress).values({ id: crypto.randomUUID(), ...values });

    await expect(
      db.insert(topicProgress).values({ id: crypto.randomUUID(), ...values })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/schema-topic-progress.test.ts`
Expected: FAIL — `topicProgress` is not exported from `@/db/schema` (TypeScript/import error).

- [ ] **Step 3: Add the table to the schema**

In `db/schema.ts`, add `real` to the existing `drizzle-orm/pg-core` import list (it currently imports `text, timestamp, boolean, index, integer, jsonb, pgEnum, unique` — add `real`), then append this block right after the existing `export type Attempt = typeof attempts.$inferSelect;` line:

```ts
export const topicProgress = pgTable(
  "topic_progress",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id),
    stability: real("stability").notNull(),
    difficulty: real("difficulty").notNull(),
    state: integer("state").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    dueAt: timestamp("due_at").notNull(),
    lastReviewedAt: timestamp("last_reviewed_at").notNull(),
  },
  (table) => [
    unique("topic_progress_user_topic_unique").on(table.userId, table.topicId),
    index("topic_progress_user_idx").on(table.userId),
    index("topic_progress_due_idx").on(table.dueAt),
  ]
);

export type TopicProgress = typeof topicProgress.$inferSelect;
```

- [ ] **Step 4: Generate and apply the migration**

Run: `npm run db:generate`
Expected: creates a new `drizzle/0006_<name>.sql` containing `CREATE TABLE "topic_progress" (...)` with the columns above, plus the FK/unique/index statements.

Run: `npm run db:migrate`
Expected: applies cleanly, no errors.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/schema-topic-progress.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add db/schema.ts drizzle/ tests/schema-topic-progress.test.ts
git commit -m "feat: add topic_progress table for FSRS state"
```

---

### Task 2: `ts-fsrs` wrapper (pure functions)

**Files:**
- Create: `lib/fsrs.ts`
- Test: `tests/fsrs-lib.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure library wrapper).
- Produces: `gradeFromAccuracy(correct: number, total: number): Grade`, `cardFromProgress(row: TopicProgressRow | null): Card`, `progressFromCard(card: Card): TopicProgressUpdate`, `TopicProgressRow` type, `WEAK_DIFFICULTY_THRESHOLD` constant — Task 3 (`lib/topic-progress.ts`) and Task 4 (`lib/dashboard.ts`) both import from this file.

- [ ] **Step 1: Install the dependency**

Run: `npm install ts-fsrs`
Expected: adds `"ts-fsrs": "^5.4.1"` (or newer patch) to `package.json` `dependencies`.

- [ ] **Step 2: Write the failing test**

Create `tests/fsrs-lib.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/fsrs-lib.test.ts`
Expected: FAIL — `@/lib/fsrs` does not exist.

- [ ] **Step 4: Write the implementation**

Create `lib/fsrs.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/fsrs-lib.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/fsrs.ts tests/fsrs-lib.test.ts
git commit -m "feat: add ts-fsrs wrapper (grade mapping, card conversion)"
```

---

### Task 3: Recompute engine (`lib/topic-progress.ts`)

**Files:**
- Create: `lib/topic-progress.ts`
- Test: `tests/topic-progress-lib.test.ts`

**Interfaces:**
- Consumes: `gradeFromAccuracy`, `cardFromProgress`, `progressFromCard`, `TopicProgressRow` from `lib/fsrs.ts` (Task 2); `topicProgress`, `attempts`, `questions` from `@/db/schema`.
- Produces: `getTopicsNeedingRecompute(userId: string): Promise<string[]>`, `applyProgressUpdate(progressId: string, expectedLastReviewedAt: Date, progress: TopicProgressUpdate): Promise<TopicProgress | undefined>`, `getOrUpdateTopicProgress(userId: string, topicId: string): Promise<TopicProgress | null>`, `recomputeAllPending(userId: string): Promise<void>` — Task 4 (`lib/dashboard.ts`) imports `recomputeAllPending` and `getTopicsNeedingRecompute`; Task 6 (`lib/recommended-session.ts`) imports `recomputeAllPending` indirectly via Task 4's `getTopicProgressRows`.

- [ ] **Step 1: Write the failing test**

Create `tests/topic-progress-lib.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { attempts, questions, topics, topicProgress, user } from "@/db/schema";
import {
  applyProgressUpdate,
  getOrUpdateTopicProgress,
  getTopicsNeedingRecompute,
} from "@/lib/topic-progress";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 900000);
}

async function createFixture() {
  const [topic] = await db
    .insert(topics)
    .values({ id: crypto.randomUUID(), area: "matematica", subject: "Matemática", name: "Álgebra" })
    .returning();

  const alternatives = [
    { letter: "A", text: "1" },
    { letter: "B", text: "2" },
    { letter: "C", text: "3" },
    { letter: "D", text: "4" },
    { letter: "E", text: "5" },
  ];

  const [question] = await db
    .insert(questions)
    .values({
      id: crypto.randomUUID(),
      year: randomTestYear(),
      examDay: 1,
      questionNumber: 1,
      area: "matematica",
      statement: "teste",
      alternatives,
      correctAnswer: "A",
      topicId: topic.id,
      status: "aprovada",
    })
    .returning();

  const [testUser] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Aluno Teste",
      email: `aluno-${crypto.randomUUID()}@example.com`,
      emailVerified: false,
    })
    .returning();

  return { topic, question, testUser };
}

async function recordAttempt(questionId: string, userId: string, isCorrect: boolean) {
  await db.insert(attempts).values({
    id: crypto.randomUUID(),
    questionId,
    userId,
    selectedAnswer: isCorrect ? "A" : "B",
    isCorrect,
  });
}

describe("getTopicsNeedingRecompute", () => {
  it("inclui um topic com tentativas mas sem topic_progress ainda", async () => {
    const { topic, question, testUser } = await createFixture();
    await recordAttempt(question.id, testUser.id, true);

    const result = await getTopicsNeedingRecompute(testUser.id);
    expect(result).toContain(topic.id);
  });

  it("não inclui um topic sem nenhuma tentativa", async () => {
    const { topic, testUser } = await createFixture();
    const result = await getTopicsNeedingRecompute(testUser.id);
    expect(result).not.toContain(topic.id);
  });
});

describe("getOrUpdateTopicProgress", () => {
  it("cria o primeiro topic_progress a partir de tentativas novas", async () => {
    const { topic, question, testUser } = await createFixture();
    await recordAttempt(question.id, testUser.id, true);
    await recordAttempt(question.id, testUser.id, true);

    const progress = await getOrUpdateTopicProgress(testUser.id, topic.id);

    expect(progress).not.toBeNull();
    expect(progress!.reps).toBe(1);
    expect(progress!.dueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("sem tentativas novas desde a última revisão, não muda nada", async () => {
    const { topic, question, testUser } = await createFixture();
    await recordAttempt(question.id, testUser.id, true);
    const first = await getOrUpdateTopicProgress(testUser.id, topic.id);

    const second = await getOrUpdateTopicProgress(testUser.id, topic.id);

    expect(second!.lastReviewedAt).toEqual(first!.lastReviewedAt);
    expect(second!.reps).toBe(first!.reps);
  });

  it("com tentativas novas, avança lastReviewedAt e reps", async () => {
    const { topic, question, testUser } = await createFixture();
    await recordAttempt(question.id, testUser.id, true);
    const first = await getOrUpdateTopicProgress(testUser.id, topic.id);

    await recordAttempt(question.id, testUser.id, true);
    const second = await getOrUpdateTopicProgress(testUser.id, topic.id);

    expect(second!.reps).toBe(first!.reps + 1);
    expect(second!.lastReviewedAt.getTime()).toBeGreaterThan(first!.lastReviewedAt.getTime());
  });

  it("sem nenhuma tentativa, devolve null", async () => {
    const { topic, testUser } = await createFixture();
    const progress = await getOrUpdateTopicProgress(testUser.id, topic.id);
    expect(progress).toBeNull();
  });
});

describe("applyProgressUpdate (guarda de concorrência)", () => {
  it("aplica a atualização quando expectedLastReviewedAt bate com o valor atual, e a rejeita na segunda tentativa com o mesmo valor esperado", async () => {
    const { topic, testUser } = await createFixture();
    const t0 = new Date("2026-08-01T00:00:00Z");

    const [existing] = await db
      .insert(topicProgress)
      .values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        topicId: topic.id,
        stability: 1,
        difficulty: 5,
        state: 1,
        lapses: 0,
        reps: 1,
        dueAt: t0,
        lastReviewedAt: t0,
      })
      .returning();

    const t1 = new Date("2026-08-10T00:00:00Z");
    const progressA = {
      stability: 2,
      difficulty: 5,
      state: 2,
      lapses: 0,
      reps: 2,
      dueAt: new Date("2026-08-20T00:00:00Z"),
      lastReviewedAt: t1,
    };

    const firstUpdate = await applyProgressUpdate(existing.id, t0, progressA);
    expect(firstUpdate).toBeDefined();
    expect(firstUpdate!.lastReviewedAt).toEqual(t1);

    const t2 = new Date("2026-08-11T00:00:00Z");
    const progressB = { ...progressA, reps: 3, lastReviewedAt: t2 };
    const secondUpdate = await applyProgressUpdate(existing.id, t0, progressB);
    expect(secondUpdate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/topic-progress-lib.test.ts`
Expected: FAIL — `@/lib/topic-progress` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/topic-progress.ts`:

```ts
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
    // onConflictDoNothing guards the same race applyProgressUpdate guards on
    // the update path: two near-simultaneous first-ever reviews of the same
    // (userId, topicId) must not both insert (topic_progress has a unique
    // constraint on that pair) — the loser falls back to the winner's row
    // instead of throwing an unhandled unique-violation error.
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
  for (const topicId of topicIds) {
    await getOrUpdateTopicProgress(userId, topicId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/topic-progress-lib.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/topic-progress.ts tests/topic-progress-lib.test.ts
git commit -m "feat: add on-demand FSRS recompute engine per topic"
```

---

### Task 4: Dashboard queries (`lib/dashboard.ts`)

**Files:**
- Create: `lib/dashboard.ts`
- Test: `tests/dashboard-lib.test.ts`

**Interfaces:**
- Consumes: `recomputeAllPending` from `lib/topic-progress.ts` (Task 3); `WEAK_DIFFICULTY_THRESHOLD` from `lib/fsrs.ts` (Task 2); `topicProgress`, `topics` from `@/db/schema`.
- Produces: `TopicProgressWithTopic` type, `selectVencidos(rows, now): TopicProgressWithTopic[]`, `selectFracos(rows): TopicProgressWithTopic[]`, `getTopicProgressRows(userId): Promise<TopicProgressWithTopic[]>`, `getDashboardData(userId): Promise<{ vencidos: TopicProgressWithTopic[]; fracos: TopicProgressWithTopic[] }>` — Task 5 (`GET /api/dashboard`) and Task 6 (`lib/recommended-session.ts`) both import `getTopicProgressRows`, `selectVencidos`, `selectFracos`.

- [ ] **Step 1: Write the failing test**

Create `tests/dashboard-lib.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selectVencidos, selectFracos, type TopicProgressWithTopic } from "@/lib/dashboard";

function makeRow(overrides: Partial<TopicProgressWithTopic>): TopicProgressWithTopic {
  return {
    topicId: crypto.randomUUID(),
    subject: "Matemática",
    area: "matematica",
    name: "Álgebra",
    dueAt: new Date("2026-09-01T00:00:00Z"),
    difficulty: 3,
    ...overrides,
  };
}

describe("selectVencidos", () => {
  it("filtra só dueAt <= now, ordenado do mais atrasado primeiro", () => {
    const now = new Date("2026-08-20T00:00:00Z");
    const overdue1 = makeRow({ dueAt: new Date("2026-08-10T00:00:00Z") });
    const overdue2 = makeRow({ dueAt: new Date("2026-08-05T00:00:00Z") });
    const notDue = makeRow({ dueAt: new Date("2026-09-01T00:00:00Z") });

    const result = selectVencidos([overdue1, notDue, overdue2], now);

    expect(result.map((r) => r.topicId)).toEqual([overdue2.topicId, overdue1.topicId]);
  });
});

describe("selectFracos", () => {
  it("filtra difficulty >= 6, ordenado do mais difícil primeiro", () => {
    const weak1 = makeRow({ difficulty: 6 });
    const weak2 = makeRow({ difficulty: 9 });
    const notWeak = makeRow({ difficulty: 5.9 });

    const result = selectFracos([weak1, notWeak, weak2]);

    expect(result.map((r) => r.topicId)).toEqual([weak2.topicId, weak1.topicId]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dashboard-lib.test.ts`
Expected: FAIL — `@/lib/dashboard` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/dashboard.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dashboard-lib.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard.ts tests/dashboard-lib.test.ts
git commit -m "feat: add vencidos/fracos derivation for the dashboard"
```

---

### Task 5: `GET /api/dashboard`

**Files:**
- Create: `app/api/dashboard/route.ts`
- Test: `tests/dashboard-api.test.ts`

**Interfaces:**
- Consumes: `requireUser` from `lib/session.ts`; `getDashboardData` from `lib/dashboard.ts` (Task 4).
- Produces: `GET` handler returning `{ vencidos: [...], fracos: [...] }` — Task 9 (`/dashboard` page) fetches this route.

- [ ] **Step 1: Write the failing test**

Create `tests/dashboard-api.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { attempts, questions, topics } from "@/db/schema";
import { GET } from "@/app/api/dashboard/route";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 900000);
}

async function createUserSession() {
  const email = `aluno-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({ body: { email, password: "senha-segura-123", name: "Aluno" } });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  const cookie = signIn.headers.get("set-cookie") ?? "";
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  return { cookie, userId: session!.user.id };
}

describe("GET /api/dashboard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/dashboard");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("um assunto some de vencidos e aparece em fracos logo após uma tentativa errada, e migra para vencidos quando o prazo do FSRS passa", async () => {
    // FSRS never schedules a review for "right now", even on the worst
    // grade (Again) — a fresh card's first review always lands some real
    // time in the future (hours, per ts-fsrs's default parameters). So a
    // single wrong attempt cannot make a topic overdue in the same instant;
    // it raises difficulty (→ fracos) immediately, and only becomes vencido
    // once real time passes the computed dueAt. This test proves both
    // halves: the immediate fracos classification, and the vencidos
    // transition once the clock crosses dueAt — using a faked Date (not
    // real timers, which would also freeze the Postgres driver's own
    // setTimeout-based internals) to simulate that passage of time.
    const { cookie, userId } = await createUserSession();

    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "matematica", subject: "Matemática", name: "Geometria" })
      .returning();

    const alternatives = [
      { letter: "A", text: "1" },
      { letter: "B", text: "2" },
      { letter: "C", text: "3" },
      { letter: "D", text: "4" },
      { letter: "E", text: "5" },
    ];

    const [question] = await db
      .insert(questions)
      .values({
        id: crypto.randomUUID(),
        year: randomTestYear(),
        examDay: 1,
        questionNumber: 1,
        area: "matematica",
        statement: "teste",
        alternatives,
        correctAnswer: "A",
        topicId: topic.id,
        status: "aprovada",
      })
      .returning();

    await db.insert(attempts).values({
      id: crypto.randomUUID(),
      questionId: question.id,
      userId,
      selectedAnswer: "B",
      isCorrect: false,
    });

    const firstRequest = new Request("http://localhost:3000/api/dashboard", {
      headers: { cookie },
    });
    const firstResponse = await GET(firstRequest);
    expect(firstResponse.status).toBe(200);

    const firstBody = await firstResponse.json();
    const notYetDue = firstBody.vencidos.find((v: { topicId: string }) => v.topicId === topic.id);
    expect(notYetDue).toBeUndefined();
    const fraco = firstBody.fracos.find((f: { topicId: string }) => f.topicId === topic.id);
    expect(fraco).toBeDefined();
    expect(fraco.name).toBe("Geometria");

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(new Date(fraco.dueAt).getTime() + 1000));

    const secondRequest = new Request("http://localhost:3000/api/dashboard", {
      headers: { cookie },
    });
    const secondResponse = await GET(secondRequest);
    expect(secondResponse.status).toBe(200);

    const secondBody = await secondResponse.json();
    const vencido = secondBody.vencidos.find((v: { topicId: string }) => v.topicId === topic.id);
    expect(vencido).toBeDefined();
    expect(vencido.name).toBe("Geometria");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dashboard-api.test.ts`
Expected: FAIL — `@/app/api/dashboard/route` does not exist.

- [ ] **Step 3: Write the implementation**

Create `app/api/dashboard/route.ts`:

```ts
import { requireUser } from "@/lib/session";
import { getDashboardData } from "@/lib/dashboard";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { vencidos, fracos } = await getDashboardData(session.user.id);
  return Response.json({ vencidos, fracos });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dashboard-api.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/dashboard/route.ts tests/dashboard-api.test.ts
git commit -m "feat: add GET /api/dashboard"
```

---

### Task 6: Recommended-session selection (`lib/recommended-session.ts`)

**Files:**
- Create: `lib/recommended-session.ts`
- Test: `tests/recommended-session-lib.test.ts`

**Interfaces:**
- Consumes: `getTopicProgressRows`, `selectVencidos`, `selectFracos`, `TopicProgressWithTopic` from `lib/dashboard.ts` (Task 4); `topics`, `questions` from `@/db/schema`.
- Produces: `CandidateTopic` type, `selectRecommendedTopics(vencidos, fracos, neverAttempted, limit?): CandidateTopic[]`, `getNeverAttemptedTopics(userId): Promise<CandidateTopic[]>`, `getRecommendedQuestionPool(topicIds): Promise<PracticeQuestion[]>`, `getRecommendedSession(userId): Promise<{ topics: CandidateTopic[]; questions: PracticeQuestion[] }>` — Task 7 (`GET /api/practice/recommended`) imports `getRecommendedSession`.

- [ ] **Step 1: Write the failing test**

Create `tests/recommended-session-lib.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selectRecommendedTopics, type CandidateTopic } from "@/lib/recommended-session";

function makeTopic(id: string): CandidateTopic {
  return { topicId: id, subject: "Matemática", area: "matematica", name: `Assunto ${id}` };
}

describe("selectRecommendedTopics", () => {
  it("prioriza vencidos, depois fracos, depois nunca-praticados, até o limite", () => {
    const vencidos = [makeTopic("v1"), makeTopic("v2")];
    const fracos = [makeTopic("f1"), makeTopic("f2")];
    const neverAttempted = [makeTopic("n1"), makeTopic("n2")];

    const result = selectRecommendedTopics(vencidos, fracos, neverAttempted, 5);

    expect(result.map((t) => t.topicId)).toEqual(["v1", "v2", "f1", "f2", "n1"]);
  });

  it("não repete um topicId presente em mais de uma lista", () => {
    const vencidos = [makeTopic("shared")];
    const fracos = [makeTopic("shared"), makeTopic("f1")];
    const neverAttempted: CandidateTopic[] = [];

    const result = selectRecommendedTopics(vencidos, fracos, neverAttempted, 5);

    expect(result.map((t) => t.topicId)).toEqual(["shared", "f1"]);
  });

  it("sem vencidos nem fracos, cai inteiramente para nunca-praticados", () => {
    const neverAttempted = [makeTopic("n1"), makeTopic("n2"), makeTopic("n3")];

    const result = selectRecommendedTopics([], [], neverAttempted, 5);

    expect(result.map((t) => t.topicId)).toEqual(["n1", "n2", "n3"]);
  });

  it("respeita o limite mesmo com candidatos de sobra", () => {
    const neverAttempted = [makeTopic("n1"), makeTopic("n2"), makeTopic("n3")];
    const result = selectRecommendedTopics([], [], neverAttempted, 2);
    expect(result).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/recommended-session-lib.test.ts`
Expected: FAIL — `@/lib/recommended-session` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/recommended-session.ts`:

```ts
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { questions, topicProgress, topics, type Alternative } from "@/db/schema";
import { getTopicProgressRows, selectFracos, selectVencidos } from "@/lib/dashboard";

const MAX_TOPICS = 5;

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
  return shuffle(rows);
}

export async function getRecommendedSession(userId: string) {
  const rows = await getTopicProgressRows(userId);
  const now = new Date();
  const vencidos = selectVencidos(rows, now);
  const fracos = selectFracos(rows);
  const neverAttempted = shuffle(await getNeverAttemptedTopics(userId));

  // Named selectedTopics/poolQuestions, not topics/questions, so they don't
  // shadow the schema table imports of the same name used above in this file.
  const selectedTopics = selectRecommendedTopics(vencidos, fracos, neverAttempted);
  const poolQuestions = await getRecommendedQuestionPool(selectedTopics.map((t) => t.topicId));

  return { topics: selectedTopics, questions: poolQuestions };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/recommended-session-lib.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/recommended-session.ts tests/recommended-session-lib.test.ts
git commit -m "feat: add recommended-session topic selection and question pool"
```

---

### Task 7: `GET /api/practice/recommended`

**Files:**
- Create: `app/api/practice/recommended/route.ts`
- Test: `tests/practice-recommended-api.test.ts`

**Interfaces:**
- Consumes: `requireUser` from `lib/session.ts`; `getRecommendedSession` from `lib/recommended-session.ts` (Task 6).
- Produces: `GET` handler returning `{ questions: PracticeQuestion[] }` — Task 10 (`/pratica/recomendada` page) fetches this route.

- [ ] **Step 1: Write the failing test**

Create `tests/practice-recommended-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";
import { GET } from "@/app/api/practice/recommended/route";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 900000);
}

async function createUserCookie() {
  const email = `aluno-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({ body: { email, password: "senha-segura-123", name: "Aluno" } });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return signIn.headers.get("set-cookie") ?? "";
}

describe("GET /api/practice/recommended", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/practice/recommended");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("para um aluno novo, devolve questões de assuntos nunca praticados", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "matematica", subject: "Matemática", name: `Assunto ${crypto.randomUUID()}` })
      .returning();

    await db.insert(questions).values({
      id: crypto.randomUUID(),
      year: randomTestYear(),
      examDay: 1,
      questionNumber: 1,
      area: "matematica",
      statement: "teste",
      alternatives: [
        { letter: "A", text: "1" },
        { letter: "B", text: "2" },
        { letter: "C", text: "3" },
        { letter: "D", text: "4" },
        { letter: "E", text: "5" },
      ],
      correctAnswer: "A",
      topicId: topic.id,
      status: "aprovada",
    });

    const cookie = await createUserCookie();
    const request = new Request("http://localhost:3000/api/practice/recommended", {
      headers: { cookie },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.questions.some((q: { topic: { id: string } }) => q.topic.id === topic.id)).toBe(
      true
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/practice-recommended-api.test.ts`
Expected: FAIL — `@/app/api/practice/recommended/route` does not exist.

- [ ] **Step 3: Write the implementation**

Create `app/api/practice/recommended/route.ts`:

```ts
import { requireUser } from "@/lib/session";
import { getRecommendedSession } from "@/lib/recommended-session";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { questions } = await getRecommendedSession(session.user.id);
  return Response.json({ questions });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/practice-recommended-api.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/practice/recommended/route.ts tests/practice-recommended-api.test.ts
git commit -m "feat: add GET /api/practice/recommended"
```

---

### Task 8: Middleware coverage for `/dashboard`

**Files:**
- Modify: `middleware.ts`
- Modify: `tests/middleware.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `/dashboard/:path*` protected the same way `/pratica/:path*` already is — Task 9's `/dashboard` page relies on this for its redirect-when-logged-out behavior.

- [ ] **Step 1: Write the failing test**

In `tests/middleware.test.ts`, add this `it` inside the existing `describe("middleware", ...)` block, right after the `"inclui /redacao/:path* no matcher..."` test:

```ts
  it("inclui /dashboard/:path* no matcher de rotas protegidas", () => {
    expect(config.matcher).toContain("/dashboard/:path*");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/middleware.test.ts`
Expected: FAIL — the new assertion, `config.matcher` doesn't contain `/dashboard/:path*` yet.

- [ ] **Step 3: Add the matcher entry**

In `middleware.ts`, add `"/dashboard/:path*"` to the `matcher` array in `export const config`:

```ts
export const config = {
  matcher: [
    "/api/:path*",
    "/admin/:path*",
    "/pratica/:path*",
    "/simulados/:path*",
    "/redacao/:path*",
    "/dashboard/:path*",
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/middleware.test.ts`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Commit**

```bash
git add middleware.ts tests/middleware.test.ts
git commit -m "feat: protect /dashboard behind the session middleware"
```

---

### Task 9: `/dashboard` page

**Files:**
- Create: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /api/dashboard` (Task 5, returns `{ vencidos, fracos }`, each item shaped `{ topicId, subject, area, name, dueAt, difficulty }`).
- Produces: the `/dashboard` route — Task 11 links to it from the Header.

- [ ] **Step 1: Write the page**

Create `app/dashboard/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

type TopicSummary = {
  topicId: string;
  subject: string;
  area: string;
  name: string;
};

type DashboardData = {
  vencidos: TopicSummary[];
  fracos: TopicSummary[];
};

function TopicList({ title, empty, items }: { title: string; empty: string; items: TopicSummary[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((topic) => (
            <Link key={topic.topicId} href={`/pratica/${encodeURIComponent(topic.subject)}/${topic.topicId}`}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between py-3">
                  <p className="font-medium">{topic.name}</p>
                  <p className="text-sm text-muted-foreground">{topic.subject}</p>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard")
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar seu progresso. Tente novamente.");
        }
        return response.json();
      })
      .then((body) => {
        if (cancelled || body === null) return;
        setData(body);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return <p className="mx-auto max-w-2xl px-4 py-8 text-destructive">{error}</p>;
  }

  if (!data) {
    return <p className="mx-auto max-w-2xl px-4 py-8">Carregando...</p>;
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <p className="font-medium">Sessão recomendada</p>
          <p className="text-sm text-muted-foreground">
            Uma sessão com os assuntos que mais precisam da sua atenção agora.
          </p>
          <Button render={<Link href="/pratica/recomendada" />}>Começar sessão recomendada</Button>
        </CardHeader>
      </Card>

      <TopicList title="Assuntos vencidos" empty="Nenhum assunto vencido agora." items={data.vencidos} />
      <TopicList title="Pontos fracos" empty="Nenhum ponto fraco identificado ainda." items={data.fracos} />
    </main>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: add /dashboard page"
```

---

### Task 10: `/pratica/recomendada` page

**Files:**
- Create: `app/pratica/recomendada/page.tsx`

**Interfaces:**
- Consumes: `GET /api/practice/recommended` (Task 7, returns `{ questions }`, each shaped like the existing `PracticeQuestion` from `/api/practice/questions`); `POST /api/practice/attempts` (existing, unchanged).
- Produces: the `/pratica/recomendada` route — Task 9's dashboard CTA links to it.

- [ ] **Step 1: Write the page**

Create `app/pratica/recomendada/page.tsx` — this mirrors `app/pratica/[subject]/[topicId]/page.tsx` exactly in its answer/feedback/summary flow; the only differences are the fetch URL, the absence of a `subject`/`topicId` route param, and the back-navigation target (`/dashboard` instead of the subject's topic list):

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type Alternative = { letter: string; text: string };

type PracticeQuestion = {
  id: string;
  year: number;
  examDay: number;
  questionNumber: number;
  statement: string;
  alternatives: Alternative[];
  imageUrl: string | null;
  topic: { id: string; area: string; subject: string; name: string };
};

export default function PraticaRecomendadaPage() {
  const router = useRouter();

  const [questions, setQuestions] = useState<PracticeQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answeredLetter, setAnsweredLetter] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ isCorrect: boolean; correctAnswer: string } | null>(
    null
  );
  const [attemptError, setAttemptError] = useState<string | null>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/practice/recommended")
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar a sessão recomendada. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || data === null) return;
        setQuestions(data.questions);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleAnswer(letter: string) {
    if (answeredLetter || !questions) return;
    setAnsweredLetter(letter);
    setAttemptError(null);

    try {
      const response = await fetch("/api/practice/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: questions[currentIndex].id,
          selectedAnswer: letter,
        }),
      });

      if (response.status === 401) {
        router.push("/entrar");
        return;
      }

      if (!response.ok) {
        setAttemptError("Não foi possível registrar essa resposta, mas você pode continuar.");
        return;
      }

      const data = await response.json();
      setFeedback({ isCorrect: data.isCorrect, correctAnswer: data.correctAnswer });
      if (data.isCorrect) setScore((prev) => prev + 1);
    } catch {
      setAttemptError("Não foi possível registrar essa resposta, mas você pode continuar.");
    }
  }

  function handleNext() {
    setAnsweredLetter(null);
    setFeedback(null);
    setAttemptError(null);
    setCurrentIndex((prev) => prev + 1);
  }

  if (error) {
    return <p className="mx-auto max-w-2xl px-4 py-8 text-destructive">{error}</p>;
  }

  if (!questions) {
    return <p className="mx-auto max-w-2xl px-4 py-8">Carregando...</p>;
  }

  if (questions.length === 0) {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8">
        <p className="text-muted-foreground">Nenhuma questão disponível pra sessão recomendada agora.</p>
        <Link href="/dashboard" className="text-sm underline">
          ← Voltar ao dashboard
        </Link>
      </main>
    );
  }

  if (currentIndex >= questions.length) {
    return (
      <main className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">
          Você acertou {score} de {questions.length}
        </h1>
        <Button render={<Link href="/dashboard" />}>Voltar ao dashboard</Button>
      </main>
    );
  }

  const question = questions[currentIndex];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <Link href="/dashboard" className="text-sm text-muted-foreground underline">
          ← {question.topic.name}
        </Link>
        <p className="text-sm text-muted-foreground">
          {currentIndex + 1} / {questions.length}
        </p>
      </div>

      {attemptError && <p className="text-sm text-destructive">{attemptError}</p>}

      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">
            {question.year} — Dia {question.examDay} — Questão {question.questionNumber}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p>{question.statement}</p>
          {question.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={question.imageUrl} alt="Figura da questão" className="max-w-sm rounded border" />
          )}
          <div className="flex flex-col gap-2">
            {question.alternatives.map((alt) => {
              const isSelected = answeredLetter === alt.letter;
              const isCorrectAnswer = feedback?.correctAnswer === alt.letter;
              let variant: "default" | "outline" | "destructive" = "outline";
              if (feedback) {
                if (isCorrectAnswer) variant = "default";
                else if (isSelected) variant = "destructive";
              } else if (isSelected) {
                variant = "default";
              }
              return (
                <Button
                  key={alt.letter}
                  type="button"
                  variant={variant}
                  className="justify-start"
                  disabled={answeredLetter !== null}
                  onClick={() => handleAnswer(alt.letter)}
                >
                  {alt.letter}) {alt.text}
                  {feedback && isCorrectAnswer && " ✓"}
                </Button>
              );
            })}
          </div>

          {answeredLetter && (
            <Button onClick={handleNext}>
              {currentIndex + 1 === questions.length ? "Ver resultado" : "Próxima"}
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/pratica/recomendada/page.tsx
git commit -m "feat: add /pratica/recomendada interleaved session page"
```

---

### Task 11: Nav entry + README

**Files:**
- Modify: `app/components/Header.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: a "Dashboard" nav link reachable from every page; a README section describing the subsystem — no code depends on these, this is the final polish/documentation task.

- [ ] **Step 1: Add the nav link**

In `app/components/Header.tsx`, add a "Dashboard" link as the first item in the logged-in nav group (before "Praticar"):

```tsx
          <Button render={<Link href="/dashboard">Dashboard</Link>} variant="link" />
          <Button render={<Link href="/pratica">Praticar</Link>} variant="link" />
```

- [ ] **Step 2: Add the README section**

In `README.md`, append this section after the existing "## Prática por assunto" section (replace the stale last sentence of that section too, since the dashboard it refers to now exists):

Change the last sentence of "## Prática por assunto" from:
```
Cada tentativa é gravada na tabela `attempts` — hoje
nenhuma tela lê esses dados, é preparação para o dashboard/recomendação
adaptativa (subsistema futuro).
```
to:
```
Cada tentativa é gravada na tabela `attempts`, lida pelo dashboard e pela
sessão recomendada descritos abaixo.
```

Then append:

```markdown

## Dashboard e recomendação adaptativa

Qualquer aluno logado acessa `/dashboard` e vê os assuntos vencidos para
revisão e os pontos fracos identificados, calculados a partir do histórico
em `attempts` usando repetição espaçada (FSRS, biblioteca `ts-fsrs`) por
assunto — não por questão individual. O card "Sessão recomendada" leva a
`/pratica/recomendada`, uma sessão que intercala questões de até 5 assuntos
(vencidos primeiro, depois os mais fracos, depois assuntos ainda não
praticados) em vez de um assunto só por vez. Todo o recálculo do estado FSRS
roda sob demanda, dentro da própria requisição do dashboard/sessão
recomendada — sem job em background.
```

- [ ] **Step 3: Verify the app builds clean**

Run: `npm run lint && npx next build && npx tsc --noEmit`
Expected: no errors (this exact order matters — `next build` generates `.next/types` that some routes' typechecking depends on, running `tsc` first produces a false failure).

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including every test added in Tasks 1–8.

- [ ] **Step 5: Commit**

```bash
git add app/components/Header.tsx README.md
git commit -m "docs: add dashboard nav entry and README section"
```

---

## Self-Review Notes

- **Spec coverage:** `topic_progress` schema (Task 1), FSRS granularity/wrapper (Task 2), recompute engine with concurrency guard (Task 3), vencidos/fracos derivation (Task 4), `GET /api/dashboard` (Task 5), recommended-session composition incl. new-user fallback (Task 6), `GET /api/practice/recommended` (Task 7), middleware (Task 8), `/dashboard` page (Task 9), `/pratica/recomendada` page (Task 10), nav + README (Task 11) — every section of the design spec maps to a task.
- **Type consistency checked:** `TopicProgressWithTopic` (Task 4) is the type both `lib/dashboard.ts` and `lib/recommended-session.ts` (Task 6) use for vencidos/fracos rows; `CandidateTopic` (Task 6) is the narrower shape used for topic selection and matches what `getNeverAttemptedTopics` and `TopicProgressWithTopic` both structurally satisfy (same four fields). `TopicProgressUpdate`/`TopicProgressRow` (Task 2) are consumed identically in Task 3's `applyProgressUpdate` and `getOrUpdateTopicProgress`.
- **No placeholders:** every step has complete, real code; no `// TODO` or "similar to Task N" shortcuts.
