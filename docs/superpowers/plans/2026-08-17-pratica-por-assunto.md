# Prática por assunto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the walking-skeleton practice loop — a logged-in student picks a matéria, then an assunto, then answers real approved ENEM questions one at a time with immediate feedback, ending in a summary screen.

**Architecture:** Follows this project's established pattern exactly: Client Components (`"use client"`) consuming new API routes via `fetch`, no Server Components. Four new API routes under `app/api/practice/`, three new pages under `app/pratica/`, one new table (`attempts`), one new auth helper (`requireUser`, mirrors the existing `requireAdmin`).

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle ORM + drizzle-kit (Postgres), Better Auth, shadcn/ui (Base UI, not Radix), Vitest against a real local Postgres.

## Global Constraints

- `requireUser` accepts ANY authenticated session regardless of `role` (`aluno` or `admin`) — unlike `requireAdmin`, there is no role check.
- `GET /api/practice/questions` must never include `correctAnswer` in its response — the gabarito must not be visible in the browser Network tab before the student answers.
- `isCorrect` in `POST /api/practice/attempts` is always computed server-side by comparing against `questions.correctAnswer` in the database — never trust a client-sent `isCorrect`.
- A practice session only ever includes questions where `status = 'aprovada'` AND `correctAnswer != 'Anulado'`.
- No session/attempt resume — closing the tab and returning to the same assunto always starts a fresh, freshly-shuffled session. There is no session entity on the server, only individual `attempts` rows (write-only from this subsystem's perspective).
- `middleware.ts`'s matcher must include `/pratica/:path*` — the same reasoning that added `/admin/:path*` in a previous subsystem applies here: without it, an unauthenticated visitor loads the page shell before any fetch 401s, instead of being redirected immediately.
- Build order for this repo is load-bearing: `npm run lint` → `npx next build` → `npx tsc --noEmit`, in that exact order (typecheck before build has caused false failures here before, because `next build` generates `.next/types` some pages depend on).
- No component-testing framework exists in this repo for Client Components — the 2 page-only tasks (Task 4, Task 5) are verified via real browser interaction, not automated tests, matching the established pattern for `/entrar` and `/admin/revisao`.
- This project's shadcn install is Base UI-based, not classic Radix — `Button` has no `asChild` prop; use `render={<Link .../>}` instead (established pattern in `app/components/Header.tsx` and `app/admin/revisao/page.tsx`).
- Dynamic route params (`[subject]`, `[topicId]`) are read via `useParams()` from `next/navigation` in Client Components — confirmed via this repo's own installed Next.js 16.3.0 docs (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-params.md`) that this hook does not require unwrapping a Promise and (since this project has no `cacheComponents` config in `next.config.ts`) does not require a `<Suspense>` boundary the way `useSearchParams()` did in `/admin/revisao`. If `npx next build` in Task 4 or 5 produces a prerender error mentioning these pages, that assumption was wrong for this exact Next.js patch version — stop and report it rather than guessing a fix, the same way the `useSearchParams()` Suspense requirement was originally discovered in this repo.
- Migrations in this repo are generated, not hand-written: `npm run db:generate` (reads `db/schema.ts`, writes a new numbered SQL file under `drizzle/`) then `npm run db:migrate` (applies it to `DATABASE_URL`). The generated SQL file must be committed — CI runs `npx drizzle-kit migrate` before tests.

---

### Task 1: `attempts` table

**Files:**
- Modify: `db/schema.ts`
- Create: a new migration file under `drizzle/` (generated, not hand-written — see Step 3)
- Test: `tests/schema-attempts.test.ts`

**Interfaces:**
- Produces: `attempts` (Drizzle table), `export type Attempt = typeof attempts.$inferSelect` — Task 3 imports `attempts` from `@/db/schema` to insert rows.

- [ ] **Step 1: Write the failing test**

Create `tests/schema-attempts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { attempts, questions, topics, user } from "@/db/schema";

function randomTestYear(): number {
  return 90000 + (Date.now() % 9000);
}

async function createTestQuestionAndUser() {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: "matematica",
      subject: "Matemática",
      name: "Álgebra",
    })
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

describe("schema de attempts", () => {
  it("cria um attempt referenciando uma question e um user reais", async () => {
    const { question, testUser } = await createTestQuestionAndUser();

    const [attempt] = await db
      .insert(attempts)
      .values({
        id: crypto.randomUUID(),
        questionId: question.id,
        userId: testUser.id,
        selectedAnswer: "A",
        isCorrect: true,
      })
      .returning();

    expect(attempt.questionId).toBe(question.id);
    expect(attempt.userId).toBe(testUser.id);
    expect(attempt.isCorrect).toBe(true);
  });

  it("rejeita attempt com questionId inexistente", async () => {
    const { testUser } = await createTestQuestionAndUser();

    await expect(
      db.insert(attempts).values({
        id: crypto.randomUUID(),
        questionId: crypto.randomUUID(),
        userId: testUser.id,
        selectedAnswer: "A",
        isCorrect: false,
      })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/schema-attempts.test.ts`
Expected: FAIL — `attempts` is not exported from `@/db/schema` (import error / undefined).

- [ ] **Step 3: Add the `attempts` table to the schema and generate the migration**

In `db/schema.ts`, add this after the `questionsRelations` block (near the bottom of the file, alongside the other table definitions — `boolean`, `index`, `text`, `timestamp` are already imported at the top of this file, no new imports needed):

```ts
export const attempts = pgTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    selectedAnswer: text("selected_answer").notNull(),
    isCorrect: boolean("is_correct").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("attempts_question_idx").on(table.questionId),
    index("attempts_user_idx").on(table.userId),
  ]
);

export type Attempt = typeof attempts.$inferSelect;
```

Then generate and apply the migration:

```bash
npm run db:generate
npm run db:migrate
```

Expected: `db:generate` prints a new file created under `drizzle/` (e.g. `drizzle/0002_<random-name>.sql`) containing a `CREATE TABLE "attempts" (...)` statement with two foreign keys (to `questions` and `user`) and two indexes. `db:migrate` applies it without error.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/schema-attempts.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts drizzle/ tests/schema-attempts.test.ts
git commit -m "feat: add attempts table for practice sessions"
```

---

### Task 2: `requireUser` helper, middleware update, and practice listing routes

**Files:**
- Create: `lib/session.ts`
- Modify: `middleware.ts`
- Create: `app/api/practice/subjects/route.ts`
- Create: `app/api/practice/topics/route.ts`
- Create: `app/api/practice/questions/route.ts`
- Test: `tests/practice-subjects-api.test.ts`
- Test: `tests/practice-topics-api.test.ts`
- Test: `tests/practice-questions-api.test.ts`

**Interfaces:**
- Consumes: `attempts` table not needed here (read-only routes). Uses `questions`, `topics` from `@/db/schema` (existing), `auth` from `@/lib/auth` (existing).
- Produces: `requireUser(request: Request): Promise<{ user: { id: string; email: string } } | null>` from `@/lib/session` — Task 3 imports and uses this exact function and return shape.
- Produces: `GET /api/practice/subjects` → `{ subjects: { subject: string; area: string; count: number }[] }`
- Produces: `GET /api/practice/topics?subject=X` → `{ topics: { id: string; name: string; count: number }[] }`
- Produces: `GET /api/practice/questions?topicId=X` → `{ questions: { id: string; year: number; examDay: number; questionNumber: number; statement: string; alternatives: { letter: string; text: string }[]; imageUrl: string | null; topic: { id: string; area: string; subject: string; name: string } }[] }` — Task 4 and Task 5 fetch from these three routes and expect exactly these shapes.

- [ ] **Step 1: Write the failing tests**

Create `tests/practice-subjects-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { topics, questions } from "@/db/schema";
import { GET } from "@/app/api/practice/subjects/route";

function randomTestYear(): number {
  return 90000 + (Date.now() % 9000);
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

async function insertQuestion(overrides: {
  subject: string;
  area: "linguagens" | "humanas" | "natureza" | "matematica";
  status: "pendente" | "aprovada" | "rejeitada";
  correctAnswer?: string;
}) {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: overrides.area,
      subject: overrides.subject,
      name: `Assunto ${crypto.randomUUID()}`,
    })
    .returning();

  await db.insert(questions).values({
    id: crypto.randomUUID(),
    year: randomTestYear(),
    examDay: 1,
    questionNumber: Math.floor(Math.random() * 500) + 1,
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
    status: overrides.status,
  });

  return topic;
}

describe("GET /api/practice/subjects", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/practice/subjects");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("lista matérias com contagem de questões aprovadas e não-anuladas", async () => {
    const subjectName = `Física ${crypto.randomUUID()}`;
    await insertQuestion({ subject: subjectName, area: "natureza", status: "aprovada" });
    await insertQuestion({ subject: subjectName, area: "natureza", status: "aprovada" });

    const { cookie } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/practice/subjects", {
      headers: { cookie },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const found = body.subjects.find((s: { subject: string }) => s.subject === subjectName);
    expect(found).toBeDefined();
    expect(found.count).toBe(2);
    expect(found.area).toBe("natureza");
  });

  it("não lista matéria cujas questões são só pendentes/rejeitadas/anuladas", async () => {
    const subjectName = `Química ${crypto.randomUUID()}`;
    await insertQuestion({ subject: subjectName, area: "natureza", status: "pendente" });
    await insertQuestion({ subject: subjectName, area: "natureza", status: "rejeitada" });
    await insertQuestion({
      subject: subjectName,
      area: "natureza",
      status: "aprovada",
      correctAnswer: "Anulado",
    });

    const { cookie } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/practice/subjects", {
      headers: { cookie },
    });
    const response = await GET(request);
    const body = await response.json();
    const found = body.subjects.find((s: { subject: string }) => s.subject === subjectName);
    expect(found).toBeUndefined();
  });
});
```

Create `tests/practice-topics-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { topics, questions } from "@/db/schema";
import { GET } from "@/app/api/practice/topics/route";

function randomTestYear(): number {
  return 90000 + (Date.now() % 9000);
}

async function createUserCookie() {
  const email = `aluno-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Aluno" },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return signIn.headers.get("set-cookie") ?? "";
}

describe("GET /api/practice/topics", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/practice/topics?subject=Física");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("lista assuntos de uma matéria com contagem de questões aprovadas", async () => {
    const subjectName = `Biologia ${crypto.randomUUID()}`;
    const [topic] = await db
      .insert(topics)
      .values({
        id: crypto.randomUUID(),
        area: "natureza",
        subject: subjectName,
        name: "Genética",
      })
      .returning();

    for (let i = 0; i < 3; i++) {
      await db.insert(questions).values({
        id: crypto.randomUUID(),
        year: randomTestYear(),
        examDay: 1,
        questionNumber: 100 + i,
        area: "natureza",
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

    const cookie = await createUserCookie();
    const request = new Request(
      `http://localhost:3000/api/practice/topics?subject=${encodeURIComponent(subjectName)}`,
      { headers: { cookie } }
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.topics).toHaveLength(1);
    expect(body.topics[0]).toMatchObject({ id: topic.id, name: "Genética", count: 3 });
  });

  it("retorna lista vazia para subject inexistente, sem erro", async () => {
    const cookie = await createUserCookie();
    const request = new Request(
      "http://localhost:3000/api/practice/topics?subject=NaoExiste12345",
      { headers: { cookie } }
    );
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.topics).toEqual([]);
  });
});
```

Create `tests/practice-questions-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { topics, questions } from "@/db/schema";
import { GET } from "@/app/api/practice/questions/route";

function randomTestYear(): number {
  return 90000 + (Date.now() % 9000);
}

async function createUserCookie() {
  const email = `aluno-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Aluno" },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return signIn.headers.get("set-cookie") ?? "";
}

describe("GET /api/practice/questions", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/practice/questions?topicId=x");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("retorna só questões aprovadas e não-anuladas do topicId, sem correctAnswer", async () => {
    const [topic] = await db
      .insert(topics)
      .values({
        id: crypto.randomUUID(),
        area: "matematica",
        subject: "Matemática",
        name: `Trigonometria ${crypto.randomUUID()}`,
      })
      .returning();

    const alternatives = [
      { letter: "A", text: "1" },
      { letter: "B", text: "2" },
      { letter: "C", text: "3" },
      { letter: "D", text: "4" },
      { letter: "E", text: "5" },
    ];

    await db.insert(questions).values([
      {
        id: crypto.randomUUID(),
        year: randomTestYear(),
        examDay: 1,
        questionNumber: 1,
        area: "matematica",
        statement: "aprovada normal",
        alternatives,
        correctAnswer: "B",
        topicId: topic.id,
        status: "aprovada",
      },
      {
        id: crypto.randomUUID(),
        year: randomTestYear(),
        examDay: 1,
        questionNumber: 2,
        area: "matematica",
        statement: "aprovada mas anulada",
        alternatives,
        correctAnswer: "Anulado",
        topicId: topic.id,
        status: "aprovada",
      },
      {
        id: crypto.randomUUID(),
        year: randomTestYear(),
        examDay: 1,
        questionNumber: 3,
        area: "matematica",
        statement: "ainda pendente",
        alternatives,
        correctAnswer: "A",
        topicId: topic.id,
        status: "pendente",
      },
    ]);

    const cookie = await createUserCookie();
    const request = new Request(
      `http://localhost:3000/api/practice/questions?topicId=${topic.id}`,
      { headers: { cookie } }
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0].statement).toBe("aprovada normal");
    expect(body.questions[0].correctAnswer).toBeUndefined();
    expect(body.questions[0].topic.name).toContain("Trigonometria");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/practice-subjects-api.test.ts tests/practice-topics-api.test.ts tests/practice-questions-api.test.ts`
Expected: FAIL — the imported route files don't exist yet.

- [ ] **Step 3: Create `lib/session.ts`**

```ts
import { auth } from "@/lib/auth";

export async function requireUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return null;
  }

  return { user: { id: session.user.id, email: session.user.email } };
}
```

- [ ] **Step 4: Add `/pratica/:path*` to the middleware matcher**

In `middleware.ts`, change:

```ts
export const config = {
  matcher: ["/api/:path*", "/admin/:path*"],
};
```

to:

```ts
export const config = {
  matcher: ["/api/:path*", "/admin/:path*", "/pratica/:path*"],
};
```

- [ ] **Step 5: Create `app/api/practice/subjects/route.ts`**

```ts
import { and, count, eq, ne } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const rows = await db
    .select({
      subject: topics.subject,
      area: topics.area,
      count: count(questions.id),
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .where(and(eq(questions.status, "aprovada"), ne(questions.correctAnswer, "Anulado")))
    .groupBy(topics.subject, topics.area);

  return Response.json({ subjects: rows });
}
```

- [ ] **Step 6: Create `app/api/practice/topics/route.ts`**

```ts
import { and, count, eq, ne } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const subject = url.searchParams.get("subject") ?? "";

  const rows = await db
    .select({
      id: topics.id,
      name: topics.name,
      count: count(questions.id),
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .where(
      and(
        eq(topics.subject, subject),
        eq(questions.status, "aprovada"),
        ne(questions.correctAnswer, "Anulado")
      )
    )
    .groupBy(topics.id, topics.name);

  return Response.json({ topics: rows });
}
```

- [ ] **Step 7: Create `app/api/practice/questions/route.ts`**

```ts
import { and, eq, ne } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const topicId = url.searchParams.get("topicId") ?? "";

  const rows = await db
    .select({
      id: questions.id,
      year: questions.year,
      examDay: questions.examDay,
      questionNumber: questions.questionNumber,
      statement: questions.statement,
      alternatives: questions.alternatives,
      imageUrl: questions.imageUrl,
      topic: {
        id: topics.id,
        area: topics.area,
        subject: topics.subject,
        name: topics.name,
      },
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .where(
      and(
        eq(questions.topicId, topicId),
        eq(questions.status, "aprovada"),
        ne(questions.correctAnswer, "Anulado")
      )
    );

  return Response.json({ questions: rows });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/practice-subjects-api.test.ts tests/practice-topics-api.test.ts tests/practice-questions-api.test.ts`
Expected: PASS (all cases).

- [ ] **Step 9: Run lint, build, typecheck (this exact order)**

```bash
npm run lint
npx next build
npx tsc --noEmit
```
Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add lib/session.ts middleware.ts app/api/practice/subjects/route.ts app/api/practice/topics/route.ts app/api/practice/questions/route.ts tests/practice-subjects-api.test.ts tests/practice-topics-api.test.ts tests/practice-questions-api.test.ts
git commit -m "feat: add practice listing API routes (subjects/topics/questions)"
```

---

### Task 3: `POST /api/practice/attempts`

**Files:**
- Create: `app/api/practice/attempts/route.ts`
- Test: `tests/practice-attempts-api.test.ts`

**Interfaces:**
- Consumes: `requireUser` from `@/lib/session` (Task 2), `attempts` and `questions` from `@/db/schema` (Task 1 / existing).
- Produces: `POST /api/practice/attempts` with body `{ questionId: string, selectedAnswer: string }` → `{ isCorrect: boolean, correctAnswer: string }` on success. Task 5 calls this exact route with this exact body/response shape.

- [ ] **Step 1: Write the failing test**

Create `tests/practice-attempts-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { attempts, topics, questions } from "@/db/schema";
import { POST } from "@/app/api/practice/attempts/route";

function randomTestYear(): number {
  return 90000 + (Date.now() % 9000);
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

async function createApprovedQuestion() {
  const [topic] = await db
    .insert(topics)
    .values({
      id: crypto.randomUUID(),
      area: "matematica",
      subject: "Matemática",
      name: `Assunto ${crypto.randomUUID()}`,
    })
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
      correctAnswer: "C",
      topicId: topic.id,
      status: "aprovada",
    })
    .returning();

  return question;
}

describe("POST /api/practice/attempts", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/practice/attempts", {
      method: "POST",
      body: JSON.stringify({ questionId: "x", selectedAnswer: "A" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("retorna 400 para corpo inválido", async () => {
    const { cookie } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/practice/attempts", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: 123 }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("retorna 404 para questionId inexistente", async () => {
    const { cookie } = await createUserCookie();
    const request = new Request("http://localhost:3000/api/practice/attempts", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: crypto.randomUUID(), selectedAnswer: "A" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(404);
  });

  it("calcula isCorrect corretamente e grava a tentativa no banco", async () => {
    const question = await createApprovedQuestion();
    const { cookie, userId } = await createUserCookie();

    const correctRequest = new Request("http://localhost:3000/api/practice/attempts", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: question.id, selectedAnswer: "C" }),
    });
    const correctResponse = await POST(correctRequest);
    expect(correctResponse.status).toBe(200);
    const correctBody = await correctResponse.json();
    expect(correctBody).toEqual({ isCorrect: true, correctAnswer: "C" });

    const wrongRequest = new Request("http://localhost:3000/api/practice/attempts", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: question.id, selectedAnswer: "A" }),
    });
    const wrongResponse = await POST(wrongRequest);
    const wrongBody = await wrongResponse.json();
    expect(wrongBody).toEqual({ isCorrect: false, correctAnswer: "C" });

    const saved = await db.select().from(attempts).where(eq(attempts.userId, userId));
    expect(saved).toHaveLength(2);
    expect(saved.map((a) => a.isCorrect).sort()).toEqual([false, true]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/practice-attempts-api.test.ts`
Expected: FAIL — `@/app/api/practice/attempts/route` doesn't exist yet.

- [ ] **Step 3: Create `app/api/practice/attempts/route.ts`**

```ts
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { attempts, questions } from "@/db/schema";

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

  const { questionId, selectedAnswer } = body as Record<string, unknown>;

  if (typeof questionId !== "string" || typeof selectedAnswer !== "string") {
    return Response.json(
      { error: "questionId e selectedAnswer são obrigatórios" },
      { status: 400 }
    );
  }

  const [question] = await db
    .select({ correctAnswer: questions.correctAnswer })
    .from(questions)
    .where(eq(questions.id, questionId));

  if (!question) {
    return Response.json({ error: "Questão não encontrada" }, { status: 404 });
  }

  const isCorrect = selectedAnswer === question.correctAnswer;

  await db.insert(attempts).values({
    id: crypto.randomUUID(),
    questionId,
    userId: session.user.id,
    selectedAnswer,
    isCorrect,
  });

  return Response.json({ isCorrect, correctAnswer: question.correctAnswer });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/practice-attempts-api.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Run lint, build, typecheck (this exact order)**

```bash
npm run lint
npx next build
npx tsc --noEmit
```
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/practice/attempts/route.ts tests/practice-attempts-api.test.ts
git commit -m "feat: add POST /api/practice/attempts"
```

---

### Task 4: Matéria and assunto list pages

**Files:**
- Create: `app/pratica/page.tsx`
- Create: `app/pratica/[subject]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/practice/subjects` and `GET /api/practice/topics?subject=X` (Task 2) — exact response shapes as documented in Task 2's Interfaces block.
- Produces: navigable routes `/pratica` and `/pratica/[subject]`, the latter linking to `/pratica/[subject]/[topicId]` (built by Task 5).

- [ ] **Step 1: Create `app/pratica/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";

type Subject = { subject: string; area: string; count: number };

export default function PraticaPage() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/practice/subjects")
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar matérias. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || data === null) return;
        setSubjects(data.subjects);
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
      <h1 className="text-2xl font-semibold">Prática por assunto</h1>

      {error && <p className="text-destructive">{error}</p>}
      {!subjects && !error && <p>Carregando...</p>}
      {subjects && subjects.length === 0 && (
        <p className="text-muted-foreground">Nenhuma questão disponível para prática ainda.</p>
      )}

      {subjects && subjects.length > 0 && (
        <div className="flex flex-col gap-3">
          {subjects.map((s) => (
            <Link key={s.subject} href={`/pratica/${encodeURIComponent(s.subject)}`}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <p className="font-medium">{s.subject}</p>
                  <p className="text-sm text-muted-foreground">{s.count} questões</p>
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

- [ ] **Step 2: Create `app/pratica/[subject]/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";

type Topic = { id: string; name: string; count: number };

export default function AssuntoListPage() {
  const params = useParams<{ subject: string }>();
  const router = useRouter();
  const subject = params.subject;

  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/practice/topics?subject=${encodeURIComponent(subject)}`)
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar assuntos. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || data === null) return;
        setTopics(data.topics);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [subject, router]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <Link href="/pratica" className="text-sm text-muted-foreground underline">
          ← Matérias
        </Link>
        <h1 className="text-2xl font-semibold">{subject}</h1>
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!topics && !error && <p>Carregando...</p>}
      {topics && topics.length === 0 && (
        <p className="text-muted-foreground">Nenhum assunto disponível para prática ainda.</p>
      )}

      {topics && topics.length > 0 && (
        <div className="flex flex-col gap-3">
          {topics.map((t) => (
            <Link key={t.id} href={`/pratica/${encodeURIComponent(subject)}/${t.id}`}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <p className="font-medium">{t.name}</p>
                  <p className="text-sm text-muted-foreground">{t.count} questões</p>
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

- [ ] **Step 3: Run lint, build, typecheck (this exact order)**

```bash
npm run lint
npx next build
npx tsc --noEmit
```
Expected: all clean. If `next build` reports a prerender error on either new page related to `useParams`/`useSearchParams`, see the Global Constraints note on this — read the actual error, don't guess a fix blindly (the established fix pattern in this repo, from `/admin/revisao`, is wrapping the component in `<Suspense>`, but confirm that's really what the error is asking for before applying it).

- [ ] **Step 4: Manual verification via real browser interaction**

Start the dev server (`npm run dev`, check what port it actually bound to) and, logged in as any user (not necessarily admin — `requireUser` accepts `aluno` too), using real browser interaction (Claude_Browser tools — not curl, not DOM-only inspection):

1. Visit `/pratica`. Confirm it lists real matérias with real counts matching what's in the local DB (e.g. via `docker exec fundacao-postgres-1 psql -U postgres -d plataforma_enem -c "SELECT subject, area, count(*) FROM questions JOIN topics ON questions.topic_id = topics.id WHERE status='aprovada' AND correct_answer != 'Anulado' GROUP BY subject, area;"` as a ground truth to compare against).
2. Click a matéria. Confirm the URL becomes `/pratica/<matéria>` and it lists real assuntos with real counts for that matéria only.
3. Confirm the "← Matérias" link goes back to `/pratica`.
4. Log out (or open a private/incognito tab) and try visiting `/pratica` directly — confirm it redirects to `/entrar` rather than showing a page shell or an error.

Do not report this step as done from reading the code alone — actually perform the 4 checks above in the running browser and note what you observed for each.

- [ ] **Step 5: Commit**

```bash
git add app/pratica/page.tsx "app/pratica/[subject]/page.tsx"
git commit -m "feat: add matéria and assunto list pages for practice"
```

---

### Task 5: Practice session page

**Files:**
- Create: `app/pratica/[subject]/[topicId]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/practice/questions?topicId=X` and `POST /api/practice/attempts` (Tasks 2 and 3) — exact shapes as documented there.

- [ ] **Step 1: Create `app/pratica/[subject]/[topicId]/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function PraticaSessaoPage() {
  const params = useParams<{ subject: string; topicId: string }>();
  const router = useRouter();
  const { subject, topicId } = params;

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
    fetch(`/api/practice/questions?topicId=${encodeURIComponent(topicId)}`)
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar questões. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || data === null) return;
        setQuestions(shuffle(data.questions));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [topicId, router]);

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
        <p className="text-muted-foreground">
          Nenhuma questão disponível ainda para este assunto.
        </p>
        <Link href={`/pratica/${encodeURIComponent(subject)}`} className="text-sm underline">
          ← Voltar aos assuntos
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
        <Button render={<Link href={`/pratica/${encodeURIComponent(subject)}`} />}>
          Voltar aos assuntos
        </Button>
      </main>
    );
  }

  const question = questions[currentIndex];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <Link
          href={`/pratica/${encodeURIComponent(subject)}`}
          className="text-sm text-muted-foreground underline"
        >
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
            <img
              src={question.imageUrl}
              alt="Figura da questão"
              className="max-w-sm rounded border"
            />
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

**Design note on colors:** the spec's prose described feedback as "verde/vermelho" (green/red) — this project's design system (`app/globals.css`) has no green/success token today, only `default` (primary blue), `destructive` (red), `outline`, `secondary`, `ghost`, `link`. Rather than hardcode an off-token green that wouldn't adapt to dark mode like the rest of the app, this implementation uses `default` (primary) for the correct answer and `destructive` (red) for a wrong selection — same right/wrong visual distinction the spec asked for, built entirely from colors already in the token system. If the founder wants literal green later, that's a design-system addition (a new `--color-success` token), not a one-off class here.

- [ ] **Step 2: Run lint, build, typecheck (this exact order)**

```bash
npm run lint
npx next build
npx tsc --noEmit
```
Expected: all clean. Same note as Task 4 about `useParams`/prerender errors, if any.

- [ ] **Step 3: Manual verification via real browser interaction**

Using real browser interaction (Claude_Browser tools — not curl, not DOM-only inspection), logged in as any user, on an assunto that has at least 2 approved questions:

1. Click into a practice session from `/pratica/<matéria>/<assunto>`. Confirm the first question renders with its statement and 5 alternatives, and the progress indicator reads "1 / N".
2. Click an alternative you know is WRONG. Confirm it turns the destructive/red variant, the actually-correct alternative turns the default/primary variant with a "✓", and a "Próxima" button appears. Confirm clicking a second alternative after this does nothing (buttons are disabled once answered).
3. Click "Próxima". Confirm the progress indicator advances and a fresh, unanswered question renders (no stale selection/feedback carried over).
4. Answer through to the last question, click the final button (labeled "Ver resultado"), and confirm the summary screen shows the correct "Você acertou X de Y" count matching what you actually answered correctly, and that "Voltar aos assuntos" navigates to `/pratica/<matéria>`.
5. Start a fresh session on the same assunto again — confirm the question order is not necessarily identical to the first run (shuffled) and that it starts from question 1 with no memory of the previous run's answers.
6. Check the Network tab on the initial `GET /api/practice/questions?topicId=...` response — confirm the JSON does NOT contain a `correctAnswer` field anywhere.
7. Simulate an attempts-recording failure: `docker stop fundacao-postgres-1`, answer a question, confirm the "não foi possível registrar" warning appears AND a "Próxima" button still appears (session is not blocked), then `docker start fundacao-postgres-1` and confirm `docker exec fundacao-postgres-1 pg_isready -U postgres` reports healthy before finishing.

Do not report this step as done from reading the code alone — actually perform all 7 checks in the running browser and note what you observed for each.

- [ ] **Step 4: Commit**

```bash
git add "app/pratica/[subject]/[topicId]/page.tsx"
git commit -m "feat: add practice session page (walking skeleton loop)"
```
