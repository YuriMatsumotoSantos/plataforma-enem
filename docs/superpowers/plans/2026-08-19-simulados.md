# Simulados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Simulados subsystem — full ENEM-format practice exams (90 questions/day) in two modes (mesclado / fiel), with free navigation, autosave/resume, and post-exam review.

**Architecture:** One new table (`simulados`) storing each exam as a JSONB snapshot (`questionIds` + `answers`), gated by approved-question-count thresholds so the feature self-unlocks as curation progresses. A pure logic module (`lib/simulados.ts`) handles question selection (fiel: exact replay; mesclado: topic-balanced draw) and scoring, kept separate from the DB-querying wrappers so the interesting behavior is unit-testable without fighting shared-database pollution. Seven API routes under `/api/simulados` plus four pages under `/simulados` follow the same `requireUser` + Client Component + `fetch` patterns already established by the Prática por assunto subsystem.

**Tech Stack:** Next.js 15 (App Router, Client Components), Drizzle ORM + Postgres, Better Auth (`requireUser`), Vitest (real local Postgres, no mocks), shadcn/ui (Base UI) components already installed (`Button`, `Card`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-19-simulados-design.md`.
- `DAY_DURATIONS`: dia 1 = 19800s (5h30), dia 2 = 18000s (5h) — official ENEM durations, snapshotted onto each row at creation.
- `DAY_AREAS`: dia 1 = `["linguagens", "humanas"]`, dia 2 = `["natureza", "matematica"]`.
- Fiel mode requires exactly `>= 90` approved questions for that `year`+`examDay`, includes `Anulado` questions (fidelity to the real exam), excludes them only from score denominators.
- Mesclado mode requires `>= 45` approved, non-`Anulado` questions per area, draws exactly 45 per area balanced across `topicId`.
- No TRI, no redação, no auto-submit at timer zero, no single 2-day session (each simulado = one day), no retry limit.
- Every route requires an authenticated session (`requireUser`) and enforces `simulado.userId === session.user.id` ownership.
- All UI copy in Portuguese, matching existing pages (`app/pratica/**`).
- Run `npm run lint && npx next build && npx tsc --noEmit` in that exact order before considering any task done (build before typecheck — `next build` generates `.next/types` that the app depends on; this order is a hard project-wide rule, see `CLAUDE.md`/memory).

---

## Task 1: Schema — `simulados` table

**Files:**
- Modify: `db/schema.ts`
- Create: `drizzle/00XX_<auto>.sql` (generated, not hand-written)
- Test: `tests/schema-simulados.test.ts`

**Interfaces:**
- Produces: `simuladoMode` (pgEnum: `"mesclado" | "fiel"`), `simuladoStatus` (pgEnum: `"em_andamento" | "finalizado"`), `simulados` table, `type Simulado = typeof simulados.$inferSelect`, `type SimuladoAnswer = { selectedAnswer: string | null; markedForReview: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `tests/schema-simulados.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { questions, simulados, topics, user } from "@/db/schema";

function randomTestYear(): number {
  return 90000 + (Date.now() % 9000);
}

async function createTestQuestionAndUser() {
  const [topic] = await db
    .insert(topics)
    .values({ id: crypto.randomUUID(), area: "matematica", subject: "Matemática", name: "Álgebra" })
    .returning();

  const [question] = await db
    .insert(questions)
    .values({
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

  return { question, testUser };
}

describe("schema de simulados", () => {
  it("cria um simulado com defaults corretos (status, answers)", async () => {
    const { question, testUser } = await createTestQuestionAndUser();

    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        mode: "mesclado",
        examDay: 1,
        questionIds: [question.id],
        durationSeconds: 19800,
      })
      .returning();

    expect(simulado.status).toBe("em_andamento");
    expect(simulado.answers).toEqual({});
    expect(simulado.questionIds).toEqual([question.id]);
    expect(simulado.finishedAt).toBeNull();
  });

  it("rejeita userId inexistente", async () => {
    const { question } = await createTestQuestionAndUser();

    await expect(
      db.insert(simulados).values({
        id: crypto.randomUUID(),
        userId: crypto.randomUUID(),
        mode: "fiel",
        examDay: 1,
        examYear: 2025,
        questionIds: [question.id],
        durationSeconds: 19800,
      })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/schema-simulados.test.ts`
Expected: FAIL — `simulados` is not exported from `@/db/schema` (TypeScript/import error, or `db.insert` throws because the table doesn't exist yet).

- [ ] **Step 3: Add the table to `db/schema.ts`**

Add after the existing `attempts` table and its `Attempt` type export (end of file), reusing the already-imported `pgTable`, `text`, `timestamp`, `integer`, `jsonb`, `pgEnum`, `index`:

```ts
export const simuladoMode = pgEnum("simulado_mode", ["mesclado", "fiel"]);
export const simuladoStatus = pgEnum("simulado_status", ["em_andamento", "finalizado"]);

export type SimuladoAnswer = { selectedAnswer: string | null; markedForReview: boolean };

export const simulados = pgTable(
  "simulados",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mode: simuladoMode("mode").notNull(),
    examDay: integer("exam_day").notNull(),
    examYear: integer("exam_year"),
    status: simuladoStatus("status").default("em_andamento").notNull(),
    questionIds: jsonb("question_ids").$type<string[]>().notNull(),
    answers: jsonb("answers")
      .$type<Record<string, SimuladoAnswer>>()
      .notNull()
      .default({}),
    durationSeconds: integer("duration_seconds").notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    index("simulados_userId_idx").on(table.userId),
    index("simulados_status_idx").on(table.status),
  ]
);

export type Simulado = typeof simulados.$inferSelect;
```

- [ ] **Step 4: Generate and apply the migration**

Run: `npm run db:generate`
Expected: creates a new file under `drizzle/` (e.g. `drizzle/0004_<name>.sql`) containing `CREATE TYPE "public"."simulado_mode"...`, `CREATE TYPE "public"."simulado_status"...`, and `CREATE TABLE "simulados"...` with the two indexes.

Run: `npm run db:migrate`
Expected: `Migrations applied successfully` (or equivalent drizzle-kit success output), no errors.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/schema-simulados.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Verify full test suite still passes and commit**

Run: `npm test`
Expected: all existing tests still PASS (schema addition is purely additive).

```bash
git add db/schema.ts drizzle/ tests/schema-simulados.test.ts
git commit -m "feat: add simulados table"
```

---

## Task 2: `lib/simulados.ts` — selection, availability, and scoring logic

**Files:**
- Create: `lib/simulados.ts`
- Test: `tests/simulados-lib.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db`, `questions`, `examArea` from `@/db/schema`.
- Produces (all consumed by later API-route tasks):
  - `type ExamArea = "linguagens" | "humanas" | "natureza" | "matematica"`
  - `DAY_DURATIONS: Record<1 | 2, number>`, `DAY_AREAS: Record<1 | 2, [ExamArea, ExamArea]>`
  - `type FielAvailability = { year: number; examDay: number; aprovadas: number; necessarias: number; disponivel: boolean }`
  - `type MescladoAvailability = { examDay: 1 | 2; areas: { area: ExamArea; aprovadas: number; necessarias: number }[]; disponivel: boolean }`
  - `type ScoredQuestion = { area: ExamArea; selectedAnswer: string | null; correctAnswer: string }`
  - `type AreaScore = { area: ExamArea; acertos: number; total: number }`
  - `pickBalancedByTopic(rows: { id: string; topicId: string }[], limit: number): string[]`
  - `pickFielQuestionIds(year: number, examDay: number): Promise<string[]>`
  - `pickMescladoQuestionIds(examDay: 1 | 2): Promise<string[]>`
  - `deriveFielAvailability(rows: { year: number; examDay: number; aprovadas: number }[]): FielAvailability[]`
  - `deriveMescladoAvailability(counts: { area: ExamArea; aprovadas: number }[]): MescladoAvailability[]`
  - `getFielAvailability(): Promise<FielAvailability[]>`
  - `getMescladoAvailability(): Promise<MescladoAvailability[]>`
  - `computeScoreByArea(items: ScoredQuestion[]): AreaScore[]`
  - `computeOverallScore(items: ScoredQuestion[]): { acertos: number; total: number }`

- [ ] **Step 1: Write the failing tests**

Create `tests/simulados-lib.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";
import {
  DAY_AREAS,
  DAY_DURATIONS,
  computeOverallScore,
  computeScoreByArea,
  deriveFielAvailability,
  deriveMescladoAvailability,
  getFielAvailability,
  getMescladoAvailability,
  pickBalancedByTopic,
  pickFielQuestionIds,
  pickMescladoQuestionIds,
} from "@/lib/simulados";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 900000);
}

async function insertQuestion(overrides: {
  year: number;
  examDay: number;
  questionNumber: number;
  area: "linguagens" | "humanas" | "natureza" | "matematica";
  status?: "pendente" | "aprovada" | "rejeitada";
  correctAnswer?: string;
}) {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: overrides.area,
      subject: "Assunto teste",
      name: `Tópico ${crypto.randomUUID()}`,
    })
    .returning();

  const [question] = await db
    .insert(questions)
    .values({
      id: crypto.randomUUID(),
      year: overrides.year,
      examDay: overrides.examDay,
      questionNumber: overrides.questionNumber,
      area: overrides.area,
      statement: "teste",
      alternatives: [
        { letter: "A", text: "1" },
        { letter: "B", text: "2" },
        { letter: "C", text: "3" },
        { letter: "D", text: "4" },
        { letter: "E", text: "5" },
      ],
      correctAnswer: overrides.correctAnswer ?? "A",
      topicId: topic.id,
      status: overrides.status ?? "aprovada",
    })
    .returning();

  return question;
}

describe("DAY_DURATIONS / DAY_AREAS", () => {
  it("tem as durações oficiais do ENEM em segundos", () => {
    expect(DAY_DURATIONS[1]).toBe(19800);
    expect(DAY_DURATIONS[2]).toBe(18000);
  });

  it("mapeia dia 1 para linguagens+humanas e dia 2 para natureza+matemática", () => {
    expect(DAY_AREAS[1]).toEqual(["linguagens", "humanas"]);
    expect(DAY_AREAS[2]).toEqual(["natureza", "matematica"]);
  });
});

describe("pickFielQuestionIds", () => {
  it("retorna só as aprovadas do year+examDay exatos, na ordem de questionNumber", async () => {
    const year = randomTestYear();
    const q2 = await insertQuestion({ year, examDay: 1, questionNumber: 2, area: "linguagens" });
    const q1 = await insertQuestion({ year, examDay: 1, questionNumber: 1, area: "linguagens" });
    await insertQuestion({
      year,
      examDay: 1,
      questionNumber: 3,
      area: "linguagens",
      status: "pendente",
    });
    await insertQuestion({ year, examDay: 2, questionNumber: 1, area: "natureza" });

    const ids = await pickFielQuestionIds(year, 1);
    expect(ids).toEqual([q1.id, q2.id]);
  });

  it("inclui questões anuladas (fidelidade ao dia real)", async () => {
    const year = randomTestYear();
    const anulada = await insertQuestion({
      year,
      examDay: 1,
      questionNumber: 1,
      area: "linguagens",
      correctAnswer: "Anulado",
    });

    const ids = await pickFielQuestionIds(year, 1);
    expect(ids).toEqual([anulada.id]);
  });
});

describe("pickBalancedByTopic", () => {
  it("espalha a seleção entre os tópicos disponíveis em vez de esgotar um só", () => {
    const rows = [
      { id: "a1", topicId: "t1" },
      { id: "a2", topicId: "t1" },
      { id: "a3", topicId: "t1" },
      { id: "b1", topicId: "t2" },
      { id: "c1", topicId: "t3" },
    ];
    const picked = pickBalancedByTopic(rows, 3);
    expect(picked).toHaveLength(3);
    const topicsUsed = new Set(picked.map((id) => rows.find((r) => r.id === id)!.topicId));
    expect(topicsUsed).toEqual(new Set(["t1", "t2", "t3"]));
  });

  it("retorna todas as disponíveis, sem duplicar, quando o total pedido excede o pool", () => {
    const rows = [
      { id: "a1", topicId: "t1" },
      { id: "b1", topicId: "t2" },
    ];
    const picked = pickBalancedByTopic(rows, 10);
    expect(picked.sort()).toEqual(["a1", "b1"]);
  });

  it("nunca repete um id", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, topicId: `t${i % 4}` }));
    const picked = pickBalancedByTopic(rows, 12);
    expect(new Set(picked).size).toBe(picked.length);
  });
});

describe("pickMescladoQuestionIds", () => {
  it("retorna 45 questões de cada área do dia (90 no total), sem duplicar", async () => {
    const yearA = randomTestYear();
    for (let i = 0; i < 50; i++) {
      await insertQuestion({ year: yearA, examDay: 1, questionNumber: i + 1, area: "linguagens" });
    }
    const yearB = yearA + 1;
    for (let i = 0; i < 50; i++) {
      await insertQuestion({ year: yearB, examDay: 1, questionNumber: i + 1, area: "humanas" });
    }

    const ids = await pickMescladoQuestionIds(1);
    expect(ids.length).toBe(90);
    expect(new Set(ids).size).toBe(90);
  });

  it("exclui questões anuladas do sorteio", async () => {
    const year = randomTestYear();
    const anulada = await insertQuestion({
      year,
      examDay: 2,
      questionNumber: 1,
      area: "natureza",
      correctAnswer: "Anulado",
    });

    const ids = await pickMescladoQuestionIds(2);
    expect(ids).not.toContain(anulada.id);
  });
});

describe("deriveFielAvailability", () => {
  it("marca disponível só quando aprovadas >= 90", () => {
    const result = deriveFielAvailability([
      { year: 2025, examDay: 1, aprovadas: 89 },
      { year: 2025, examDay: 2, aprovadas: 90 },
    ]);
    expect(result.find((r) => r.examDay === 1)!.disponivel).toBe(false);
    expect(result.find((r) => r.examDay === 2)!.disponivel).toBe(true);
    expect(result.every((r) => r.necessarias === 90)).toBe(true);
  });
});

describe("deriveMescladoAvailability", () => {
  it("marca o dia disponível só quando AMBAS as áreas do dia têm >= 45", () => {
    const result = deriveMescladoAvailability([
      { area: "linguagens", aprovadas: 45 },
      { area: "humanas", aprovadas: 44 },
      { area: "natureza", aprovadas: 45 },
      { area: "matematica", aprovadas: 45 },
    ]);
    expect(result.find((r) => r.examDay === 1)!.disponivel).toBe(false);
    expect(result.find((r) => r.examDay === 2)!.disponivel).toBe(true);
  });

  it("trata área sem nenhuma aprovada como 0, não como ausente", () => {
    const result = deriveMescladoAvailability([{ area: "linguagens", aprovadas: 50 }]);
    const dia1 = result.find((r) => r.examDay === 1)!;
    expect(dia1.areas.find((a) => a.area === "humanas")!.aprovadas).toBe(0);
    expect(dia1.disponivel).toBe(false);
  });
});

describe("getFielAvailability (integração)", () => {
  it("reflete as aprovadas reais de um year+day isolado", async () => {
    const year = randomTestYear();
    for (let i = 0; i < 3; i++) {
      await insertQuestion({ year, examDay: 1, questionNumber: i + 1, area: "linguagens" });
    }
    const result = await getFielAvailability();
    const found = result.find((r) => r.year === year && r.examDay === 1);
    expect(found?.aprovadas).toBe(3);
    expect(found?.disponivel).toBe(false);
  });
});

describe("getMescladoAvailability (integração)", () => {
  it("aumenta a contagem da área conforme aprovadas são inseridas", async () => {
    const before = await getMescladoAvailability();
    const beforeCount = before
      .find((d) => d.examDay === 1)!
      .areas.find((a) => a.area === "linguagens")!.aprovadas;

    const year = randomTestYear();
    for (let i = 0; i < 4; i++) {
      await insertQuestion({ year, examDay: 1, questionNumber: i + 1, area: "linguagens" });
    }

    const after = await getMescladoAvailability();
    const afterCount = after
      .find((d) => d.examDay === 1)!
      .areas.find((a) => a.area === "linguagens")!.aprovadas;

    expect(afterCount - beforeCount).toBe(4);
  });
});

describe("computeScoreByArea", () => {
  it("conta acertos e total por área, ignorando anuladas", () => {
    const result = computeScoreByArea([
      { area: "linguagens", selectedAnswer: "A", correctAnswer: "A" },
      { area: "linguagens", selectedAnswer: "B", correctAnswer: "A" },
      { area: "linguagens", selectedAnswer: null, correctAnswer: "Anulado" },
      { area: "humanas", selectedAnswer: "C", correctAnswer: "C" },
    ]);
    expect(result.find((r) => r.area === "linguagens")).toEqual({
      area: "linguagens",
      acertos: 1,
      total: 2,
    });
    expect(result.find((r) => r.area === "humanas")).toEqual({
      area: "humanas",
      acertos: 1,
      total: 1,
    });
  });
});

describe("computeOverallScore", () => {
  it("soma acertos e total de todas as áreas", () => {
    const result = computeOverallScore([
      { area: "linguagens", selectedAnswer: "A", correctAnswer: "A" },
      { area: "humanas", selectedAnswer: "X", correctAnswer: "C" },
    ]);
    expect(result).toEqual({ acertos: 1, total: 2 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/simulados-lib.test.ts`
Expected: FAIL — `Cannot find module '@/lib/simulados'`.

- [ ] **Step 3: Write `lib/simulados.ts`**

```ts
import { and, count, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { examArea, questions } from "@/db/schema";

export type ExamArea = (typeof examArea.enumValues)[number];

export const DAY_DURATIONS: Record<1 | 2, number> = { 1: 19800, 2: 18000 };

export const DAY_AREAS: Record<1 | 2, [ExamArea, ExamArea]> = {
  1: ["linguagens", "humanas"],
  2: ["natureza", "matematica"],
};

const FIEL_REQUIRED = 90;
const QUESTIONS_PER_AREA = 45;

export type FielAvailability = {
  year: number;
  examDay: number;
  aprovadas: number;
  necessarias: number;
  disponivel: boolean;
};

export type MescladoAvailability = {
  examDay: 1 | 2;
  areas: { area: ExamArea; aprovadas: number; necessarias: number }[];
  disponivel: boolean;
};

export type ScoredQuestion = {
  area: ExamArea;
  selectedAnswer: string | null;
  correctAnswer: string;
};

export type AreaScore = { area: ExamArea; acertos: number; total: number };

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function pickBalancedByTopic(
  rows: { id: string; topicId: string }[],
  limit: number
): string[] {
  const byTopic = new Map<string, string[]>();
  for (const row of rows) {
    const list = byTopic.get(row.topicId) ?? [];
    list.push(row.id);
    byTopic.set(row.topicId, list);
  }
  const topicQueues = shuffle([...byTopic.values()]).map((ids) => shuffle(ids));

  const picked: string[] = [];
  let round = 0;
  while (picked.length < limit) {
    let addedThisRound = false;
    for (const queue of topicQueues) {
      if (picked.length >= limit) break;
      const id = queue[round];
      if (id) {
        picked.push(id);
        addedThisRound = true;
      }
    }
    if (!addedThisRound) break;
    round += 1;
  }
  return picked;
}

export async function pickFielQuestionIds(year: number, examDay: number): Promise<string[]> {
  const rows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      and(
        eq(questions.year, year),
        eq(questions.examDay, examDay),
        eq(questions.status, "aprovada")
      )
    )
    .orderBy(questions.questionNumber);
  return rows.map((r) => r.id);
}

export async function pickMescladoQuestionIds(examDay: 1 | 2): Promise<string[]> {
  const picked: string[] = [];
  for (const area of DAY_AREAS[examDay]) {
    const rows = await db
      .select({ id: questions.id, topicId: questions.topicId })
      .from(questions)
      .where(
        and(
          eq(questions.area, area),
          eq(questions.status, "aprovada"),
          ne(questions.correctAnswer, "Anulado")
        )
      );
    picked.push(...pickBalancedByTopic(rows, QUESTIONS_PER_AREA));
  }
  return picked;
}

export function deriveFielAvailability(
  rows: { year: number; examDay: number; aprovadas: number }[]
): FielAvailability[] {
  return rows.map((row) => ({
    ...row,
    necessarias: FIEL_REQUIRED,
    disponivel: row.aprovadas >= FIEL_REQUIRED,
  }));
}

export function deriveMescladoAvailability(
  counts: { area: ExamArea; aprovadas: number }[]
): MescladoAvailability[] {
  return ([1, 2] as const).map((examDay) => {
    const areas = DAY_AREAS[examDay].map((area) => {
      const found = counts.find((c) => c.area === area);
      return { area, aprovadas: found?.aprovadas ?? 0, necessarias: QUESTIONS_PER_AREA };
    });
    return { examDay, areas, disponivel: areas.every((a) => a.aprovadas >= QUESTIONS_PER_AREA) };
  });
}

export async function getFielAvailability(): Promise<FielAvailability[]> {
  const rows = await db
    .select({ year: questions.year, examDay: questions.examDay, aprovadas: count(questions.id) })
    .from(questions)
    .where(eq(questions.status, "aprovada"))
    .groupBy(questions.year, questions.examDay);
  return deriveFielAvailability(rows);
}

export async function getMescladoAvailability(): Promise<MescladoAvailability[]> {
  const rows = await db
    .select({ area: questions.area, aprovadas: count(questions.id) })
    .from(questions)
    .where(and(eq(questions.status, "aprovada"), ne(questions.correctAnswer, "Anulado")))
    .groupBy(questions.area);
  return deriveMescladoAvailability(rows);
}

export function computeScoreByArea(items: ScoredQuestion[]): AreaScore[] {
  const byArea = new Map<ExamArea, { acertos: number; total: number }>();
  for (const item of items) {
    if (item.correctAnswer === "Anulado") continue;
    const entry = byArea.get(item.area) ?? { acertos: 0, total: 0 };
    entry.total += 1;
    if (item.selectedAnswer === item.correctAnswer) entry.acertos += 1;
    byArea.set(item.area, entry);
  }
  return [...byArea.entries()].map(([area, v]) => ({ area, ...v }));
}

export function computeOverallScore(items: ScoredQuestion[]): { acertos: number; total: number } {
  return computeScoreByArea(items).reduce(
    (acc, area) => ({ acertos: acc.acertos + area.acertos, total: acc.total + area.total }),
    { acertos: 0, total: 0 }
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/simulados-lib.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add lib/simulados.ts tests/simulados-lib.test.ts
git commit -m "feat: add simulado question-selection, availability, and scoring logic"
```

---

## Task 3: `GET /api/simulados/available`

**Files:**
- Create: `app/api/simulados/available/route.ts`
- Test: `tests/simulados-available-api.test.ts`

**Interfaces:**
- Consumes: `requireUser` from `@/lib/session`, `getFielAvailability`, `getMescladoAvailability` from `@/lib/simulados` (Task 2).
- Produces: `GET` handler returning `{ fiel: FielAvailability[], mesclado: MescladoAvailability[] }`.

- [ ] **Step 1: Write the failing test**

Create `tests/simulados-available-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";
import { GET } from "@/app/api/simulados/available/route";

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
  return { cookie: signIn.headers.get("set-cookie") ?? "" };
}

async function insertApprovedQuestion(overrides: {
  year: number;
  examDay: number;
  questionNumber: number;
  area: "linguagens" | "humanas" | "natureza" | "matematica";
}) {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: overrides.area,
      subject: "Assunto teste",
      name: `Tópico ${crypto.randomUUID()}`,
    })
    .returning();

  await db.insert(questions).values({
    id: crypto.randomUUID(),
    year: overrides.year,
    examDay: overrides.examDay,
    questionNumber: overrides.questionNumber,
    area: overrides.area,
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
}

describe("GET /api/simulados/available", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/simulados/available");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("mostra um year+day como disponível só quando chega em 90 aprovadas", async () => {
    const year = randomTestYear();
    for (let i = 0; i < 90; i++) {
      await insertApprovedQuestion({ year, examDay: 1, questionNumber: i + 1, area: "linguagens" });
    }

    const { cookie } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/simulados/available", {
      headers: { cookie },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const found = body.fiel.find(
      (f: { year: number; examDay: number }) => f.year === year && f.examDay === 1
    );
    expect(found.disponivel).toBe(true);
    expect(found.aprovadas).toBe(90);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/simulados-available-api.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/simulados/available/route'`.

- [ ] **Step 3: Write the route**

Create `app/api/simulados/available/route.ts`:

```ts
import { requireUser } from "@/lib/session";
import { getFielAvailability, getMescladoAvailability } from "@/lib/simulados";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const [fiel, mesclado] = await Promise.all([getFielAvailability(), getMescladoAvailability()]);
  return Response.json({ fiel, mesclado });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/simulados-available-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/simulados/available/route.ts tests/simulados-available-api.test.ts
git commit -m "feat: add GET /api/simulados/available"
```

---

## Task 4: `POST /api/simulados` (create) + `GET /api/simulados` (history)

**Files:**
- Create: `app/api/simulados/route.ts`
- Test: `tests/simulados-create-api.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `db`, `simulados`/`questions` schema, `DAY_DURATIONS`, `pickFielQuestionIds`, `pickMescladoQuestionIds`, `getFielAvailability`, `getMescladoAvailability`, `computeOverallScore` (all from Task 2).
- Produces: `POST` → `{ id: string }` (201... use 200 to match project convention of not using 201 elsewhere) or `{ error }` (400/401). `GET` → `{ simulados: { id, mode, examDay, examYear, status, startedAt, finishedAt, score: {acertos, total} | null }[] }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/simulados-create-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { questions, simulados, topics } from "@/db/schema";
import { POST, GET } from "@/app/api/simulados/route";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 900000);
}

async function createUserCookie() {
  const email = `aluno-${crypto.randomUUID()}@example.com`;
  const signUp = await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Aluno" },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return { cookie: signIn.headers.get("set-cookie") ?? "", userId: signUp.user.id };
}

async function insertApprovedQuestion(overrides: {
  year: number;
  examDay: number;
  questionNumber: number;
  area: "linguagens" | "humanas" | "natureza" | "matematica";
  correctAnswer?: string;
}) {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: overrides.area,
      subject: "Assunto teste",
      name: `Tópico ${crypto.randomUUID()}`,
    })
    .returning();

  const [question] = await db
    .insert(questions)
    .values({
      id: crypto.randomUUID(),
      year: overrides.year,
      examDay: overrides.examDay,
      questionNumber: overrides.questionNumber,
      area: overrides.area,
      statement: "teste",
      alternatives: [
        { letter: "A", text: "1" },
        { letter: "B", text: "2" },
        { letter: "C", text: "3" },
        { letter: "D", text: "4" },
        { letter: "E", text: "5" },
      ],
      correctAnswer: overrides.correctAnswer ?? "A",
      topicId: topic.id,
      status: "aprovada",
    })
    .returning();

  return question;
}

describe("POST /api/simulados", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/simulados", {
      method: "POST",
      body: JSON.stringify({ mode: "fiel", examDay: 1, examYear: 2025 }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("retorna 400 quando o modo fiel pedido ainda não tem 90 aprovadas", async () => {
    const year = randomTestYear();
    const { cookie } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/simulados", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "fiel", examDay: 1, examYear: year }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("cria um simulado fiel com as 90 questões quando disponível", async () => {
    const year = randomTestYear();
    for (let i = 0; i < 90; i++) {
      await insertApprovedQuestion({ year, examDay: 1, questionNumber: i + 1, area: "linguagens" });
    }
    const { cookie, userId } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/simulados", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "fiel", examDay: 1, examYear: year }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();

    const [saved] = await db.select().from(simulados).where(eq(simulados.id, body.id));
    expect(saved.userId).toBe(userId);
    expect(saved.mode).toBe("fiel");
    expect(saved.examYear).toBe(year);
    expect(saved.questionIds).toHaveLength(90);
    expect(saved.durationSeconds).toBe(19800);
    expect(saved.status).toBe("em_andamento");
  });
});

describe("GET /api/simulados", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/simulados");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("lista os simulados do usuário com nota calculada para os finalizados", async () => {
    const question = await insertApprovedQuestion({
      year: randomTestYear(),
      examDay: 1,
      questionNumber: 1,
      area: "linguagens",
    });
    const { cookie, userId } = await createUserCookie();

    await db.insert(simulados).values({
      id: crypto.randomUUID(),
      userId,
      mode: "mesclado",
      examDay: 1,
      questionIds: [question.id],
      answers: { [question.id]: { selectedAnswer: "A", markedForReview: false } },
      durationSeconds: 19800,
      status: "finalizado",
      finishedAt: new Date(),
    });

    const request = new Request("http://localhost:3000/api/simulados", { headers: { cookie } });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.simulados).toHaveLength(1);
    expect(body.simulados[0].score).toEqual({ acertos: 1, total: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/simulados-create-api.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/simulados/route'`.

- [ ] **Step 3: Write the route**

Create `app/api/simulados/route.ts`:

```ts
import { desc, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { questions, simulados } from "@/db/schema";
import {
  DAY_DURATIONS,
  computeOverallScore,
  getFielAvailability,
  getMescladoAvailability,
  pickFielQuestionIds,
  pickMescladoQuestionIds,
} from "@/lib/simulados";

const VALID_MODES = ["mesclado", "fiel"] as const;
const VALID_DAYS = [1, 2] as const;

export async function POST(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const { mode, examDay, examYear } = body as Record<string, unknown>;

  if (!VALID_MODES.some((m) => m === mode)) {
    return Response.json({ error: "mode inválido" }, { status: 400 });
  }
  if (!VALID_DAYS.some((d) => d === examDay)) {
    return Response.json({ error: "examDay inválido" }, { status: 400 });
  }
  const day = examDay as 1 | 2;

  if (mode === "fiel") {
    if (typeof examYear !== "number") {
      return Response.json({ error: "examYear é obrigatório para o modo fiel" }, { status: 400 });
    }
    const availability = await getFielAvailability();
    const match = availability.find((a) => a.year === examYear && a.examDay === day);
    if (!match || !match.disponivel) {
      return Response.json(
        { error: "Este simulado fiel ainda não está disponível" },
        { status: 400 }
      );
    }
    const questionIds = await pickFielQuestionIds(examYear, day);
    const [created] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId: session.user.id,
        mode: "fiel",
        examDay: day,
        examYear,
        questionIds,
        durationSeconds: DAY_DURATIONS[day],
      })
      .returning({ id: simulados.id });
    return Response.json({ id: created.id });
  }

  const availability = await getMescladoAvailability();
  const match = availability.find((a) => a.examDay === day);
  if (!match || !match.disponivel) {
    return Response.json(
      { error: "Este simulado mesclado ainda não está disponível" },
      { status: 400 }
    );
  }
  const questionIds = await pickMescladoQuestionIds(day);
  const [created] = await db
    .insert(simulados)
    .values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      mode: "mesclado",
      examDay: day,
      questionIds,
      durationSeconds: DAY_DURATIONS[day],
    })
    .returning({ id: simulados.id });
  return Response.json({ id: created.id });
}

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(simulados)
    .where(eq(simulados.userId, session.user.id))
    .orderBy(desc(simulados.startedAt));

  const history = await Promise.all(
    rows.map(async (row) => {
      let score: { acertos: number; total: number } | null = null;
      if (row.status === "finalizado") {
        const questionRows = await db
          .select({ id: questions.id, area: questions.area, correctAnswer: questions.correctAnswer })
          .from(questions)
          .where(inArray(questions.id, row.questionIds));
        score = computeOverallScore(
          questionRows.map((q) => ({
            area: q.area,
            correctAnswer: q.correctAnswer,
            selectedAnswer: row.answers[q.id]?.selectedAnswer ?? null,
          }))
        );
      }
      return {
        id: row.id,
        mode: row.mode,
        examDay: row.examDay,
        examYear: row.examYear,
        status: row.status,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        score,
      };
    })
  );

  return Response.json({ simulados: history });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/simulados-create-api.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/simulados/route.ts tests/simulados-create-api.test.ts
git commit -m "feat: add POST/GET /api/simulados (create + history)"
```

---

## Task 5: `GET /api/simulados/[id]`

**Files:**
- Create: `app/api/simulados/[id]/route.ts`
- Test: `tests/simulados-get-api.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `db`, `simulados`, `questions`, `topics` (schema).
- Produces: `GET` → `{ id, mode, examDay, examYear, status, startedAt, durationSeconds, answers, questions: { id, area, statement, alternatives, imageUrl, topic: {id, name} }[] }`, ordered per the simulado's own `questionIds`. 404 if missing or not owned by the caller.

- [ ] **Step 1: Write the failing test**

Create `tests/simulados-get-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { questions, simulados, topics } from "@/db/schema";
import { GET } from "@/app/api/simulados/[id]/route";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 900000);
}

async function createUserCookie() {
  const email = `aluno-${crypto.randomUUID()}@example.com`;
  const signUp = await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Aluno" },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return { cookie: signIn.headers.get("set-cookie") ?? "", userId: signUp.user.id };
}

async function insertApprovedQuestion() {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: "linguagens",
      subject: "Assunto teste",
      name: `Tópico ${crypto.randomUUID()}`,
    })
    .returning();

  const [question] = await db
    .insert(questions)
    .values({
      id: crypto.randomUUID(),
      year: randomTestYear(),
      examDay: 1,
      questionNumber: 1,
      area: "linguagens",
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
    })
    .returning();

  return question;
}

describe("GET /api/simulados/[id]", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/simulados/x");
    const response = await GET(request, { params: Promise.resolve({ id: "x" }) });
    expect(response.status).toBe(401);
  });

  it("retorna 404 quando o simulado é de outro usuário", async () => {
    const question = await insertApprovedQuestion();
    const owner = await createUserCookie();
    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId: owner.userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [question.id],
        durationSeconds: 19800,
      })
      .returning();

    const other = await createUserCookie();
    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}`, {
      headers: { cookie: other.cookie },
    });
    const response = await GET(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(404);
  });

  it("retorna o pacote completo na ordem de questionIds, com respostas atuais", async () => {
    const q1 = await insertApprovedQuestion();
    const q2 = await insertApprovedQuestion();
    const { cookie, userId } = await createUserCookie();
    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [q2.id, q1.id],
        answers: { [q2.id]: { selectedAnswer: "B", markedForReview: true } },
        durationSeconds: 19800,
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}`, {
      headers: { cookie },
    });
    const response = await GET(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.questions.map((q: { id: string }) => q.id)).toEqual([q2.id, q1.id]);
    expect(body.answers[q2.id]).toEqual({ selectedAnswer: "B", markedForReview: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/simulados-get-api.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the route**

Create `app/api/simulados/[id]/route.ts`:

```ts
import { eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { questions, simulados, topics } from "@/db/schema";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;

  const [simulado] = await db.select().from(simulados).where(eq(simulados.id, id));
  if (!simulado || simulado.userId !== session.user.id) {
    return Response.json({ error: "Simulado não encontrado" }, { status: 404 });
  }

  const questionRows = await db
    .select({
      id: questions.id,
      area: questions.area,
      statement: questions.statement,
      alternatives: questions.alternatives,
      imageUrl: questions.imageUrl,
      topic: { id: topics.id, name: topics.name },
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .where(inArray(questions.id, simulado.questionIds));

  const byId = new Map(questionRows.map((q) => [q.id, q]));
  const orderedQuestions = simulado.questionIds
    .map((qid) => byId.get(qid))
    .filter((q): q is NonNullable<typeof q> => q !== undefined);

  return Response.json({
    id: simulado.id,
    mode: simulado.mode,
    examDay: simulado.examDay,
    examYear: simulado.examYear,
    status: simulado.status,
    startedAt: simulado.startedAt,
    durationSeconds: simulado.durationSeconds,
    answers: simulado.answers,
    questions: orderedQuestions,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/simulados-get-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/api/simulados/[id]/route.ts" tests/simulados-get-api.test.ts
git commit -m "feat: add GET /api/simulados/[id]"
```

---

## Task 6: `PATCH /api/simulados/[id]/respostas`

**Files:**
- Create: `app/api/simulados/[id]/respostas/route.ts`
- Test: `tests/simulados-respostas-api.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `db`, `simulados` (schema).
- Produces: `PATCH` accepting `{ questionId: string; selectedAnswer?: string | null; markedForReview?: boolean }`, merging into `simulado.answers[questionId]`. Returns `{ ok: true }` or `{ error }` (400/401/404).

- [ ] **Step 1: Write the failing tests**

Create `tests/simulados-respostas-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { questions, simulados, topics } from "@/db/schema";
import { PATCH } from "@/app/api/simulados/[id]/respostas/route";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 900000);
}

async function createUserCookie() {
  const email = `aluno-${crypto.randomUUID()}@example.com`;
  const signUp = await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Aluno" },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return { cookie: signIn.headers.get("set-cookie") ?? "", userId: signUp.user.id };
}

async function insertApprovedQuestion() {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: "linguagens",
      subject: "Assunto teste",
      name: `Tópico ${crypto.randomUUID()}`,
    })
    .returning();

  const [question] = await db
    .insert(questions)
    .values({
      id: crypto.randomUUID(),
      year: randomTestYear(),
      examDay: 1,
      questionNumber: 1,
      area: "linguagens",
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
    })
    .returning();

  return question;
}

describe("PATCH /api/simulados/[id]/respostas", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/simulados/x/respostas", {
      method: "PATCH",
      body: JSON.stringify({ questionId: "x", selectedAnswer: "A" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "x" }) });
    expect(response.status).toBe(401);
  });

  it("retorna 400 quando a questão não pertence ao simulado", async () => {
    const question = await insertApprovedQuestion();
    const { cookie, userId } = await createUserCookie();
    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [question.id],
        durationSeconds: 19800,
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}/respostas`, {
      method: "PATCH",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: crypto.randomUUID(), selectedAnswer: "A" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(400);
  });

  it("salva selectedAnswer e markedForReview separadamente, sem apagar o outro campo", async () => {
    const question = await insertApprovedQuestion();
    const { cookie, userId } = await createUserCookie();
    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [question.id],
        durationSeconds: 19800,
      })
      .returning();

    const firstRequest = new Request(
      `http://localhost:3000/api/simulados/${simulado.id}/respostas`,
      {
        method: "PATCH",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, selectedAnswer: "B" }),
      }
    );
    expect(
      (await PATCH(firstRequest, { params: Promise.resolve({ id: simulado.id }) })).status
    ).toBe(200);

    const secondRequest = new Request(
      `http://localhost:3000/api/simulados/${simulado.id}/respostas`,
      {
        method: "PATCH",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, markedForReview: true }),
      }
    );
    expect(
      (await PATCH(secondRequest, { params: Promise.resolve({ id: simulado.id }) })).status
    ).toBe(200);

    const [saved] = await db.select().from(simulados).where(eq(simulados.id, simulado.id));
    expect(saved.answers[question.id]).toEqual({ selectedAnswer: "B", markedForReview: true });
  });

  it("retorna 400 ao tentar responder um simulado já finalizado", async () => {
    const question = await insertApprovedQuestion();
    const { cookie, userId } = await createUserCookie();
    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [question.id],
        durationSeconds: 19800,
        status: "finalizado",
        finishedAt: new Date(),
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}/respostas`, {
      method: "PATCH",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: question.id, selectedAnswer: "A" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/simulados-respostas-api.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the route**

Create `app/api/simulados/[id]/respostas/route.ts`:

```ts
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { simulados } from "@/db/schema";

const VALID_LETTERS = ["A", "B", "C", "D", "E"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const { questionId, selectedAnswer, markedForReview } = body as Record<string, unknown>;

  if (typeof questionId !== "string") {
    return Response.json({ error: "questionId é obrigatório" }, { status: 400 });
  }
  if (
    selectedAnswer !== undefined &&
    selectedAnswer !== null &&
    !VALID_LETTERS.some((l) => l === selectedAnswer)
  ) {
    return Response.json({ error: "selectedAnswer inválido" }, { status: 400 });
  }
  if (markedForReview !== undefined && typeof markedForReview !== "boolean") {
    return Response.json({ error: "markedForReview inválido" }, { status: 400 });
  }

  const [simulado] = await db.select().from(simulados).where(eq(simulados.id, id));
  if (!simulado || simulado.userId !== session.user.id) {
    return Response.json({ error: "Simulado não encontrado" }, { status: 404 });
  }
  if (simulado.status !== "em_andamento") {
    return Response.json({ error: "Este simulado já foi finalizado" }, { status: 400 });
  }
  if (!simulado.questionIds.includes(questionId)) {
    return Response.json({ error: "Questão não faz parte deste simulado" }, { status: 400 });
  }

  const current = simulado.answers[questionId] ?? { selectedAnswer: null, markedForReview: false };
  const updated = {
    selectedAnswer:
      selectedAnswer === undefined ? current.selectedAnswer : (selectedAnswer as string | null),
    markedForReview: markedForReview === undefined ? current.markedForReview : markedForReview,
  };

  await db
    .update(simulados)
    .set({ answers: { ...simulado.answers, [questionId]: updated } })
    .where(eq(simulados.id, id));

  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/simulados-respostas-api.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add "app/api/simulados/[id]/respostas/route.ts" tests/simulados-respostas-api.test.ts
git commit -m "feat: add PATCH /api/simulados/[id]/respostas (autosave)"
```

---

## Task 7: `POST /api/simulados/[id]/finalizar`

**Files:**
- Create: `app/api/simulados/[id]/finalizar/route.ts`
- Test: `tests/simulados-finalizar-api.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `db`, `simulados`, `questions`, `attempts` (schema).
- Produces: `POST` → sets `status = "finalizado"`, `finishedAt = now`, inserts one `attempts` row per answered non-`Anulado` question. Returns `{ ok: true }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/simulados-finalizar-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { attempts, questions, simulados, topics } from "@/db/schema";
import { POST } from "@/app/api/simulados/[id]/finalizar/route";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 900000);
}

async function createUserCookie() {
  const email = `aluno-${crypto.randomUUID()}@example.com`;
  const signUp = await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Aluno" },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return { cookie: signIn.headers.get("set-cookie") ?? "", userId: signUp.user.id };
}

async function insertApprovedQuestion(correctAnswer = "A") {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: "linguagens",
      subject: "Assunto teste",
      name: `Tópico ${crypto.randomUUID()}`,
    })
    .returning();

  const [question] = await db
    .insert(questions)
    .values({
      id: crypto.randomUUID(),
      year: randomTestYear(),
      examDay: 1,
      questionNumber: 1,
      area: "linguagens",
      statement: "teste",
      alternatives: [
        { letter: "A", text: "1" },
        { letter: "B", text: "2" },
        { letter: "C", text: "3" },
        { letter: "D", text: "4" },
        { letter: "E", text: "5" },
      ],
      correctAnswer,
      topicId: topic.id,
      status: "aprovada",
    })
    .returning();

  return question;
}

describe("POST /api/simulados/[id]/finalizar", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/simulados/x/finalizar", {
      method: "POST",
    });
    const response = await POST(request, { params: Promise.resolve({ id: "x" }) });
    expect(response.status).toBe(401);
  });

  it("marca finalizado e grava attempts só das questões respondidas e não-anuladas", async () => {
    const answered = await insertApprovedQuestion("A");
    const blank = await insertApprovedQuestion("B");
    const anulada = await insertApprovedQuestion("Anulado");
    const { cookie, userId } = await createUserCookie();

    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [answered.id, blank.id, anulada.id],
        answers: {
          [answered.id]: { selectedAnswer: "A", markedForReview: false },
          [anulada.id]: { selectedAnswer: "C", markedForReview: false },
        },
        durationSeconds: 19800,
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}/finalizar`, {
      method: "POST",
      headers: { cookie },
    });
    const response = await POST(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(200);

    const [saved] = await db.select().from(simulados).where(eq(simulados.id, simulado.id));
    expect(saved.status).toBe("finalizado");
    expect(saved.finishedAt).not.toBeNull();

    const answeredAttempts = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.userId, userId), eq(attempts.questionId, answered.id)));
    expect(answeredAttempts).toHaveLength(1);
    expect(answeredAttempts[0].isCorrect).toBe(true);

    const anuladaAttempts = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.userId, userId), eq(attempts.questionId, anulada.id)));
    expect(anuladaAttempts).toHaveLength(0);

    const blankAttempts = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.userId, userId), eq(attempts.questionId, blank.id)));
    expect(blankAttempts).toHaveLength(0);
  });

  it("retorna 400 ao tentar finalizar de novo um simulado já finalizado", async () => {
    const question = await insertApprovedQuestion();
    const { cookie, userId } = await createUserCookie();
    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [question.id],
        durationSeconds: 19800,
        status: "finalizado",
        finishedAt: new Date(),
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}/finalizar`, {
      method: "POST",
      headers: { cookie },
    });
    const response = await POST(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/simulados-finalizar-api.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the route**

Create `app/api/simulados/[id]/finalizar/route.ts`:

```ts
import { eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { attempts, questions, simulados } from "@/db/schema";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;

  const [simulado] = await db.select().from(simulados).where(eq(simulados.id, id));
  if (!simulado || simulado.userId !== session.user.id) {
    return Response.json({ error: "Simulado não encontrado" }, { status: 404 });
  }
  if (simulado.status !== "em_andamento") {
    return Response.json({ error: "Este simulado já foi finalizado" }, { status: 400 });
  }

  const answeredIds = Object.entries(simulado.answers)
    .filter(([, a]) => a.selectedAnswer !== null)
    .map(([questionId]) => questionId);

  if (answeredIds.length > 0) {
    const answeredQuestions = await db
      .select({ id: questions.id, correctAnswer: questions.correctAnswer })
      .from(questions)
      .where(inArray(questions.id, answeredIds));

    const attemptRows = answeredQuestions
      .filter((q) => q.correctAnswer !== "Anulado")
      .map((q) => ({
        id: crypto.randomUUID(),
        questionId: q.id,
        userId: session.user.id,
        selectedAnswer: simulado.answers[q.id].selectedAnswer as string,
        isCorrect: simulado.answers[q.id].selectedAnswer === q.correctAnswer,
      }));

    if (attemptRows.length > 0) {
      await db.insert(attempts).values(attemptRows);
    }
  }

  await db
    .update(simulados)
    .set({ status: "finalizado", finishedAt: new Date() })
    .where(eq(simulados.id, id));

  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/simulados-finalizar-api.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add "app/api/simulados/[id]/finalizar/route.ts" tests/simulados-finalizar-api.test.ts
git commit -m "feat: add POST /api/simulados/[id]/finalizar"
```

---

## Task 8: `GET /api/simulados/[id]/resultado`

**Files:**
- Create: `app/api/simulados/[id]/resultado/route.ts`
- Test: `tests/simulados-resultado-api.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `db`, `simulados`, `questions`, `topics` (schema), `computeScoreByArea` (Task 2).
- Produces: `GET` → `{ scoreByArea: AreaScore[], questions: { id, area, statement, alternatives, correctAnswer, imageUrl, topic: {id, name}, selectedAnswer }[] }`. 403 if not `finalizado`.

- [ ] **Step 1: Write the failing tests**

Create `tests/simulados-resultado-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { questions, simulados, topics } from "@/db/schema";
import { GET } from "@/app/api/simulados/[id]/resultado/route";

function randomTestYear(): number {
  return 90000 + Math.floor(Math.random() * 900000);
}

async function createUserCookie() {
  const email = `aluno-${crypto.randomUUID()}@example.com`;
  const signUp = await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Aluno" },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return { cookie: signIn.headers.get("set-cookie") ?? "", userId: signUp.user.id };
}

async function insertApprovedQuestion(area: "linguagens" | "humanas", correctAnswer = "A") {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area,
      subject: "Assunto teste",
      name: `Tópico ${crypto.randomUUID()}`,
    })
    .returning();

  const [question] = await db
    .insert(questions)
    .values({
      id: crypto.randomUUID(),
      year: randomTestYear(),
      examDay: 1,
      questionNumber: 1,
      area,
      statement: "teste",
      alternatives: [
        { letter: "A", text: "1" },
        { letter: "B", text: "2" },
        { letter: "C", text: "3" },
        { letter: "D", text: "4" },
        { letter: "E", text: "5" },
      ],
      correctAnswer,
      topicId: topic.id,
      status: "aprovada",
    })
    .returning();

  return question;
}

describe("GET /api/simulados/[id]/resultado", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/simulados/x/resultado");
    const response = await GET(request, { params: Promise.resolve({ id: "x" }) });
    expect(response.status).toBe(401);
  });

  it("retorna 403 quando o simulado ainda está em andamento", async () => {
    const question = await insertApprovedQuestion("linguagens");
    const { cookie, userId } = await createUserCookie();
    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [question.id],
        durationSeconds: 19800,
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}/resultado`, {
      headers: { cookie },
    });
    const response = await GET(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(403);
  });

  it("retorna nota por área e a revisão questão a questão", async () => {
    const l1 = await insertApprovedQuestion("linguagens", "A");
    const l2 = await insertApprovedQuestion("linguagens", "B");
    const h1 = await insertApprovedQuestion("humanas", "C");
    const { cookie, userId } = await createUserCookie();

    const [simulado] = await db
      .insert(simulados)
      .values({
        id: crypto.randomUUID(),
        userId,
        mode: "mesclado",
        examDay: 1,
        questionIds: [l1.id, l2.id, h1.id],
        answers: {
          [l1.id]: { selectedAnswer: "A", markedForReview: false },
          [l2.id]: { selectedAnswer: "X", markedForReview: false },
          [h1.id]: { selectedAnswer: "C", markedForReview: false },
        },
        durationSeconds: 19800,
        status: "finalizado",
        finishedAt: new Date(),
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/simulados/${simulado.id}/resultado`, {
      headers: { cookie },
    });
    const response = await GET(request, { params: Promise.resolve({ id: simulado.id }) });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.scoreByArea).toEqual(
      expect.arrayContaining([
        { area: "linguagens", acertos: 1, total: 2 },
        { area: "humanas", acertos: 1, total: 1 },
      ])
    );
    expect(body.questions).toHaveLength(3);
    expect(body.questions.find((q: { id: string }) => q.id === l2.id).selectedAnswer).toBe("X");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/simulados-resultado-api.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the route**

Create `app/api/simulados/[id]/resultado/route.ts`:

```ts
import { eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { questions, simulados, topics } from "@/db/schema";
import { computeScoreByArea } from "@/lib/simulados";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;

  const [simulado] = await db.select().from(simulados).where(eq(simulados.id, id));
  if (!simulado || simulado.userId !== session.user.id) {
    return Response.json({ error: "Simulado não encontrado" }, { status: 404 });
  }
  if (simulado.status !== "finalizado") {
    return Response.json({ error: "Este simulado ainda não foi finalizado" }, { status: 403 });
  }

  const questionRows = await db
    .select({
      id: questions.id,
      area: questions.area,
      statement: questions.statement,
      alternatives: questions.alternatives,
      correctAnswer: questions.correctAnswer,
      imageUrl: questions.imageUrl,
      topic: { id: topics.id, name: topics.name },
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .where(inArray(questions.id, simulado.questionIds));

  const byId = new Map(questionRows.map((q) => [q.id, q]));
  const orderedQuestions = simulado.questionIds
    .map((qid) => byId.get(qid))
    .filter((q): q is NonNullable<typeof q> => q !== undefined);

  const scoreByArea = computeScoreByArea(
    orderedQuestions.map((q) => ({
      area: q.area,
      correctAnswer: q.correctAnswer,
      selectedAnswer: simulado.answers[q.id]?.selectedAnswer ?? null,
    }))
  );

  const review = orderedQuestions.map((q) => ({
    id: q.id,
    area: q.area,
    statement: q.statement,
    alternatives: q.alternatives,
    correctAnswer: q.correctAnswer,
    imageUrl: q.imageUrl,
    topic: q.topic,
    selectedAnswer: simulado.answers[q.id]?.selectedAnswer ?? null,
  }));

  return Response.json({ scoreByArea, questions: review });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/simulados-resultado-api.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add "app/api/simulados/[id]/resultado/route.ts" tests/simulados-resultado-api.test.ts
git commit -m "feat: add GET /api/simulados/[id]/resultado"
```

---

## Task 9: Protect `/simulados/*` in middleware + add nav link

**Files:**
- Modify: `middleware.ts`
- Modify: `app/components/Header.tsx`
- Test: `tests/middleware.test.ts`

**Interfaces:**
- Consumes: existing `middleware`/`config` from `middleware.ts`.
- Produces: `config.matcher` now includes `/simulados/:path*`; `Header` renders a "Simulados" link for logged-in users.

- [ ] **Step 1: Write the failing test**

Add to `tests/middleware.test.ts` (after the existing `/pratica/:path*` matcher test, inside the same `describe("middleware", ...)` block):

```ts
  it("inclui /simulados/:path* no matcher de rotas protegidas", () => {
    expect(config.matcher).toContain("/simulados/:path*");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/middleware.test.ts`
Expected: FAIL — `config.matcher` does not contain `/simulados/:path*`.

- [ ] **Step 3: Update the matcher**

In `middleware.ts`, change:

```ts
export const config = {
  matcher: ["/api/:path*", "/admin/:path*", "/pratica/:path*"],
};
```

to:

```ts
export const config = {
  matcher: ["/api/:path*", "/admin/:path*", "/pratica/:path*", "/simulados/:path*"],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/middleware.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Add the nav link**

In `app/components/Header.tsx`, change:

```tsx
          <Button render={<Link href="/pratica">Praticar</Link>} variant="link" />
```

to:

```tsx
          <Button render={<Link href="/pratica">Praticar</Link>} variant="link" />
          <Button render={<Link href="/simulados">Simulados</Link>} variant="link" />
```

- [ ] **Step 6: Commit**

```bash
git add middleware.ts app/components/Header.tsx tests/middleware.test.ts
git commit -m "feat: protect /simulados routes and add nav link"
```

---

## Task 10: `/simulados` (landing) and `/simulados/historico` pages

**Files:**
- Create: `app/simulados/page.tsx`
- Create: `app/simulados/historico/page.tsx`

**Interfaces:**
- Consumes: `GET /api/simulados/available` (Task 3), `POST /api/simulados` (Task 4), `GET /api/simulados` (Task 4).
- Produces: two Client Component pages. No new automated tests (matches the project's established pattern — Client Component pages that only fetch-and-render are verified manually in the browser, same as `app/pratica/page.tsx`; see Task 12 for the manual verification pass).

- [ ] **Step 1: Write `app/simulados/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type FielOption = {
  year: number;
  examDay: number;
  aprovadas: number;
  necessarias: number;
  disponivel: boolean;
};

type MescladoOption = {
  examDay: 1 | 2;
  areas: { area: string; aprovadas: number; necessarias: number }[];
  disponivel: boolean;
};

const AREA_LABELS: Record<string, string> = {
  linguagens: "Linguagens",
  humanas: "Humanas",
  natureza: "Natureza",
  matematica: "Matemática",
};

export default function SimuladosPage() {
  const router = useRouter();
  const [fiel, setFiel] = useState<FielOption[] | null>(null);
  const [mesclado, setMesclado] = useState<MescladoOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/simulados/available")
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar simulados disponíveis. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || data === null) return;
        setFiel(data.fiel);
        setMesclado(data.mesclado);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleStart(body: {
    mode: "fiel" | "mesclado";
    examDay: number;
    examYear?: number;
  }) {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/simulados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        router.push("/entrar");
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? "Não foi possível iniciar o simulado.");
        return;
      }
      const data = await response.json();
      router.push(`/simulados/${data.id}`);
    } catch {
      setError("Não foi possível iniciar o simulado.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Simulados</h1>
        <Link href="/simulados/historico" className="text-sm underline">
          Histórico
        </Link>
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!fiel && !mesclado && !error && <p>Carregando...</p>}

      {mesclado && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Mesclado</h2>
          <p className="text-sm text-muted-foreground">
            45 questões de cada área, sorteadas entre todos os anos disponíveis.
          </p>
          {mesclado.map((option) => (
            <Card key={option.examDay}>
              <CardHeader className="flex flex-row items-center justify-between">
                <p className="font-medium">Dia {option.examDay}</p>
                {option.disponivel ? (
                  <Button
                    type="button"
                    disabled={creating}
                    onClick={() => handleStart({ mode: "mesclado", examDay: option.examDay })}
                  >
                    Iniciar
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">Indisponível</p>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
                {option.areas.map((area) => (
                  <p key={area.area}>
                    {AREA_LABELS[area.area] ?? area.area}: {area.aprovadas}/{area.necessarias}{" "}
                    aprovadas
                  </p>
                ))}
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {fiel && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Fiel a uma prova real</h2>
          <p className="text-sm text-muted-foreground">
            As mesmas 90 questões de um dia real do ENEM, na ordem original.
          </p>
          {fiel.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum exame com dados suficientes ainda.
            </p>
          )}
          {fiel.map((option) => (
            <Card key={`${option.year}-${option.examDay}`}>
              <CardHeader className="flex flex-row items-center justify-between">
                <p className="font-medium">
                  ENEM {option.year} — Dia {option.examDay}
                </p>
                {option.disponivel ? (
                  <Button
                    type="button"
                    disabled={creating}
                    onClick={() =>
                      handleStart({ mode: "fiel", examDay: option.examDay, examYear: option.year })
                    }
                  >
                    Iniciar
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {option.aprovadas}/{option.necessarias} aprovadas
                  </p>
                )}
              </CardHeader>
            </Card>
          ))}
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Write `app/simulados/historico/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";

type SimuladoHistoryItem = {
  id: string;
  mode: "mesclado" | "fiel";
  examDay: number;
  examYear: number | null;
  status: "em_andamento" | "finalizado";
  startedAt: string;
  finishedAt: string | null;
  score: { acertos: number; total: number } | null;
};

export default function SimuladosHistoricoPage() {
  const router = useRouter();
  const [history, setHistory] = useState<SimuladoHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/simulados")
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar histórico. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || data === null) return;
        setHistory(data.simulados);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Histórico de simulados</h1>
        <Link href="/simulados" className="text-sm underline">
          ← Novo simulado
        </Link>
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!history && !error && <p>Carregando...</p>}
      {history && history.length === 0 && (
        <p className="text-muted-foreground">Você ainda não fez nenhum simulado.</p>
      )}

      {history && history.length > 0 && (
        <div className="flex flex-col gap-3">
          {history.map((item) => (
            <Link
              key={item.id}
              href={
                item.status === "finalizado"
                  ? `/simulados/${item.id}/resultado`
                  : `/simulados/${item.id}`
              }
            >
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {item.mode === "fiel" ? `ENEM ${item.examYear}` : "Mesclado"} — Dia{" "}
                      {item.examDay}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(item.startedAt).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  {item.status === "finalizado" && item.score ? (
                    <p className="text-sm font-medium">
                      {item.score.acertos}/{item.score.total}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Continuar</p>
                  )}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add app/simulados/page.tsx app/simulados/historico/page.tsx
git commit -m "feat: add simulados landing and history pages"
```

---

## Task 11: `/simulados/[id]` — exam-taking page

**Files:**
- Create: `app/simulados/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/simulados/[id]` (Task 5), `PATCH /api/simulados/[id]/respostas` (Task 6), `POST /api/simulados/[id]/finalizar` (Task 7).
- Produces: Client Component page with free navigation grid, timer, autosave, and finish flow. No new automated test (UI-only orchestration of already-tested routes) — verified manually in Task 12's browser pass, per the project's established convention for this kind of page (see `app/pratica/[subject]/[topicId]/page.tsx`).

- [ ] **Step 1: Write `app/simulados/[id]/page.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type Alternative = { letter: string; text: string };

type SimuladoQuestion = {
  id: string;
  area: string;
  statement: string;
  alternatives: Alternative[];
  imageUrl: string | null;
  topic: { id: string; name: string };
};

type Answer = { selectedAnswer: string | null; markedForReview: boolean };

type SimuladoData = {
  id: string;
  mode: "mesclado" | "fiel";
  examDay: number;
  examYear: number | null;
  status: "em_andamento" | "finalizado";
  startedAt: string;
  durationSeconds: number;
  answers: Record<string, Answer>;
  questions: SimuladoQuestion[];
};

function formatTime(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const abs = Math.abs(Math.round(totalSeconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function SimuladoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { id } = params;

  const [data, setData] = useState<SimuladoData | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [finalizing, setFinalizing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/simulados/${id}`)
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (response.status === 404) {
          throw new Error("Simulado não encontrado.");
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar o simulado. Tente novamente.");
        }
        return response.json();
      })
      .then((json: SimuladoData | null) => {
        if (cancelled || json === null) return;
        if (json.status === "finalizado") {
          router.push(`/simulados/${id}/resultado`);
          return;
        }
        setData(json);
        setAnswers(json.answers);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const remainingSeconds = useMemo(() => {
    if (!data) return null;
    const elapsed = (now - new Date(data.startedAt).getTime()) / 1000;
    return data.durationSeconds - elapsed;
  }, [data, now]);

  async function saveAnswer(questionId: string, patch: Partial<Answer>) {
    const current = answers[questionId] ?? { selectedAnswer: null, markedForReview: false };
    const updated = { ...current, ...patch };
    setAnswers((prev) => ({ ...prev, [questionId]: updated }));

    try {
      const response = await fetch(`/api/simulados/${id}/respostas`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, ...patch }),
      });
      if (response.status === 401) {
        router.push("/entrar");
      }
    } catch {
      // autosave falhou silenciosamente; a resposta continua marcada localmente
      // e o próximo clique tenta salvar de novo — sem bloquear o aluno no meio da prova.
    }
  }

  async function handleFinalizar() {
    if (!data) return;
    const blanks = data.questions.filter((q) => !answers[q.id]?.selectedAnswer).length;
    if (blanks > 0) {
      const confirmed = window.confirm(
        `Você tem ${blanks} questão(ões) em branco. Finalizar mesmo assim?`
      );
      if (!confirmed) return;
    }

    setFinalizing(true);
    try {
      const response = await fetch(`/api/simulados/${id}/finalizar`, { method: "POST" });
      if (response.status === 401) {
        router.push("/entrar");
        return;
      }
      if (!response.ok) {
        setError("Não foi possível finalizar o simulado. Tente novamente.");
        setFinalizing(false);
        return;
      }
      router.push(`/simulados/${id}/resultado`);
    } catch {
      setError("Não foi possível finalizar o simulado. Tente novamente.");
      setFinalizing(false);
    }
  }

  if (error) {
    return <p className="mx-auto max-w-2xl px-4 py-8 text-destructive">{error}</p>;
  }

  if (!data) {
    return <p className="mx-auto max-w-2xl px-4 py-8">Carregando...</p>;
  }

  const question = data.questions[currentIndex];
  const currentAnswer = answers[question.id] ?? { selectedAnswer: null, markedForReview: false };

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <p className="font-medium">
          {data.mode === "fiel" ? `ENEM ${data.examYear}` : "Mesclado"} — Dia {data.examDay}
        </p>
        <p
          className={`font-mono text-sm ${
            remainingSeconds !== null && remainingSeconds < 0 ? "text-destructive" : ""
          }`}
        >
          {remainingSeconds !== null ? formatTime(remainingSeconds) : "--:--:--"}
        </p>
      </div>

      <div className="grid grid-cols-10 gap-1">
        {data.questions.map((q, index) => {
          const a = answers[q.id];
          const isCurrent = index === currentIndex;
          let variant: "default" | "outline" | "secondary" = "outline";
          if (isCurrent) variant = "default";
          else if (a?.markedForReview || a?.selectedAnswer) variant = "secondary";
          return (
            <Button
              key={q.id}
              type="button"
              size="sm"
              variant={variant}
              className={a?.markedForReview && !isCurrent ? "ring-2 ring-yellow-500" : ""}
              onClick={() => setCurrentIndex(index)}
            >
              {index + 1}
            </Button>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">
            Questão {currentIndex + 1} de {data.questions.length} — {question.topic.name}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p>{question.statement}</p>
          {question.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={question.imageUrl}
              alt="Figura da questão"
              className="max-w-sm rounded border"
            />
          )}
          <div className="flex flex-col gap-2">
            {question.alternatives.map((alt) => (
              <Button
                key={alt.letter}
                type="button"
                variant={currentAnswer.selectedAnswer === alt.letter ? "default" : "outline"}
                className="justify-start"
                onClick={() => saveAnswer(question.id, { selectedAnswer: alt.letter })}
              >
                {alt.letter}) {alt.text}
              </Button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                saveAnswer(question.id, { markedForReview: !currentAnswer.markedForReview })
              }
            >
              {currentAnswer.markedForReview ? "Remover marcação" : "Marcar pra revisar"}
            </Button>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((i) => i - 1)}
              >
                Anterior
              </Button>
              {currentIndex + 1 < data.questions.length ? (
                <Button type="button" onClick={() => setCurrentIndex((i) => i + 1)}>
                  Próxima
                </Button>
              ) : null}
              <Button type="button" disabled={finalizing} onClick={handleFinalizar}>
                Finalizar simulado
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add "app/simulados/[id]/page.tsx"
git commit -m "feat: add simulado exam-taking page"
```

---

## Task 12: `/simulados/[id]/resultado` — result and review page

**Files:**
- Create: `app/simulados/[id]/resultado/page.tsx`

**Interfaces:**
- Consumes: `GET /api/simulados/[id]/resultado` (Task 8).
- Produces: Client Component page rendering per-area score and full question-by-question review.

- [ ] **Step 1: Write `app/simulados/[id]/resultado/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type Alternative = { letter: string; text: string };

type AreaScore = { area: string; acertos: number; total: number };

type ReviewQuestion = {
  id: string;
  area: string;
  statement: string;
  alternatives: Alternative[];
  correctAnswer: string;
  imageUrl: string | null;
  topic: { id: string; name: string };
  selectedAnswer: string | null;
};

const AREA_LABELS: Record<string, string> = {
  linguagens: "Linguagens",
  humanas: "Humanas",
  natureza: "Natureza",
  matematica: "Matemática",
};

export default function SimuladoResultadoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { id } = params;

  const [scoreByArea, setScoreByArea] = useState<AreaScore[] | null>(null);
  const [questions, setQuestions] = useState<ReviewQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/simulados/${id}/resultado`)
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (response.status === 403) {
          throw new Error("Este simulado ainda não foi finalizado.");
        }
        if (response.status === 404) {
          throw new Error("Simulado não encontrado.");
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar o resultado. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || data === null) return;
        setScoreByArea(data.scoreByArea);
        setQuestions(data.questions);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  if (error) {
    return <p className="mx-auto max-w-2xl px-4 py-8 text-destructive">{error}</p>;
  }

  if (!scoreByArea || !questions) {
    return <p className="mx-auto max-w-2xl px-4 py-8">Carregando...</p>;
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Resultado</h1>
        <Link href="/simulados/historico" className="text-sm underline">
          ← Histórico
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        {scoreByArea.map((s) => (
          <p key={s.area}>
            {AREA_LABELS[s.area] ?? s.area}: {s.acertos}/{s.total}
          </p>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Revisão questão a questão</h2>
        {questions.map((q, index) => (
          <Card key={q.id}>
            <CardHeader>
              <p className="text-sm text-muted-foreground">
                Questão {index + 1} — {q.topic.name}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p>{q.statement}</p>
              {q.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={q.imageUrl}
                  alt="Figura da questão"
                  className="max-w-sm rounded border"
                />
              )}
              <div className="flex flex-col gap-1">
                {q.alternatives.map((alt) => {
                  const isCorrect = alt.letter === q.correctAnswer;
                  const isSelected = alt.letter === q.selectedAnswer;
                  let className = "";
                  if (isCorrect) className = "text-green-600 font-medium";
                  else if (isSelected) className = "text-destructive";
                  return (
                    <p key={alt.letter} className={className}>
                      {alt.letter}) {alt.text}
                      {isCorrect && " ✓"}
                      {isSelected && !isCorrect && " (sua resposta)"}
                    </p>
                  );
                })}
              </div>
              {q.selectedAnswer === null && (
                <p className="text-sm text-muted-foreground">Questão deixada em branco.</p>
              )}
              {q.correctAnswer === "Anulado" && (
                <p className="text-sm text-muted-foreground">Questão anulada.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck, lint, build**

Run: `npm run lint`
Expected: no errors.

Run: `npx next build`
Expected: build succeeds, all 4 new pages listed in the route output.

Run: `npx tsc --noEmit`
Expected: no errors (run after build, per this project's established order — see Global Constraints).

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all tests pass (existing + all new ones from Tasks 1–8).

- [ ] **Step 4: Manual browser verification**

Using the running dev server (`npm run dev` in this worktree, on whatever port is free — check `.env.local`'s `NEXT_PUBLIC_APP_URL`/`BETTER_AUTH_URL` match the actual bound port before testing, per this project's known multi-worktree port gotcha):

1. Seed enough approved data for at least one mesclado day and one fiel exam (insert directly via `docker exec fundacao-postgres-1 psql ...` or reuse existing approved rows if any day/area already clears the threshold).
2. Log in, visit `/simulados` — confirm locked options show progress and unlocked ones show "Iniciar".
3. Start a mesclado simulado — confirm the grid renders, answering an alternative highlights it and updates the grid cell, "Marcar pra revisar" toggles, the timer counts down.
4. Reload the page mid-exam — confirm answers and remaining time are preserved (resume).
5. Finalize with some questions blank — confirm the confirmation prompt appears, then the result page shows per-area score and full review with correct/selected answers marked.
6. Visit `/simulados/historico` — confirm the finished simulado appears with its score and links to the result page.

- [ ] **Step 5: Commit**

```bash
git add "app/simulados/[id]/resultado/page.tsx"
git commit -m "feat: add simulado result and review page"
```
