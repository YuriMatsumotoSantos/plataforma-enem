# Redação com correção por IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in student pick a real ENEM essay theme, write a text, and get it graded by the Claude API against the 5 official ENEM competências (0-1000), with a saved history of past redações.

**Architecture:** Two new Drizzle tables (`temas`, `redacoes`). A lazily-initialized Anthropic client (`lib/anthropic.ts`) mirroring the existing `lib/gemini.ts` pattern. A pure grading function (`lib/redacao.ts`) that calls Claude with a forced tool-use schema and clamps scores to the valid ENEM steps. Four API routes under `/api/redacao/*` following the existing `requireUser` + Drizzle pattern used by Prática and Simulados. Four pages under `/redacao/*` as client components fetching those routes, matching `app/pratica/page.tsx`'s style. A one-time idempotent seed script for temas (no admin CRUD UI — too few rows to justify one).

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle ORM + Postgres, `@anthropic-ai/sdk` (new dependency), Vitest, shadcn/ui (Card, Button, Textarea, Badge).

## Global Constraints

- Every DB-touching test runs against the real local Postgres (`fundacao-postgres-1`, port 5433) — no mocked DB. Only the Anthropic API call is mocked in tests (`vi.mock`).
- `fileParallelism: false` in `vitest.config.ts` — do not remove it, tests share one DB.
- Auth: use `requireUser(request)` from `lib/session.ts` in every route; it returns `null` on no session (respond 401), or `{ user: { id, email } }`.
- Run `npm run lint && npx next build && npx tsc --noEmit` in that exact order before considering any task done (build before typecheck — `next build` generates `.next/types` that some routes may implicitly depend on; this is a documented project-wide gotcha).
- All UI copy in Portuguese, matching the rest of the app.
- New tables follow the existing schema conventions: `id: text("id").primaryKey()` (populated with `crypto.randomUUID()` at insert time, not a DB default), `userId` references with `onDelete: "cascade"`, indexes on FK columns that get queried.
- `ANTHROPIC_API_KEY` is read directly from `process.env` inside `lib/anthropic.ts`'s lazy client getter — it must NOT be added to `lib/env.ts`'s strict `envSchema` (that schema is for infra vars only; `GEMINI_API_KEY` already follows this same exclusion).
- No `ANTHROPIC_API_KEY` exists in this environment. Every task must be completable and testable (via mocks) without one. Task 3's manual live-API smoke test is the only step that requires a real key and is explicitly called out as blocked/deferred.

---

### Task 1: Schema — `temas` and `redacoes` tables

**Files:**
- Modify: `db/schema.ts` (append at end of file)
- Test: `tests/schema-redacoes.test.ts`

**Interfaces:**
- Produces: `temas` table, `Tema` type (`{ id, title, createdAt }`); `redacoes` table, `Redacao` type; `RedacaoScores` type (`{ competencia1..5: number }`); `RedacaoFeedback` type (`{ justificativas: string[], comentarioGeral: string }`).

- [ ] **Step 1: Write the failing test**

Create `tests/schema-redacoes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user, temas, redacoes } from "@/db/schema";

async function createTestUser() {
  const [row] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Aluno Teste",
      email: `redacao-schema-${crypto.randomUUID()}@example.com`,
      emailVerified: false,
    })
    .returning();
  return row;
}

describe("schema: temas e redacoes", () => {
  it("insere um tema e lê de volta", async () => {
    const [tema] = await db
      .insert(temas)
      .values({ id: crypto.randomUUID(), title: `Tema teste ${crypto.randomUUID()}` })
      .returning();

    const [found] = await db.select().from(temas).where(eq(temas.id, tema.id));
    expect(found.title).toBe(tema.title);
  });

  it("insere uma redação com scores e feedback em JSONB e lê de volta", async () => {
    const testUser = await createTestUser();
    const [tema] = await db
      .insert(temas)
      .values({ id: crypto.randomUUID(), title: `Tema teste ${crypto.randomUUID()}` })
      .returning();

    const scores = {
      competencia1: 200,
      competencia2: 160,
      competencia3: 120,
      competencia4: 200,
      competencia5: 160,
    };
    const feedback = {
      justificativas: ["ok", "ok", "ok", "ok", "ok"],
      comentarioGeral: "Bom texto.",
    };

    const [redacao] = await db
      .insert(redacoes)
      .values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        temaId: tema.id,
        text: "Texto de teste com pelo menos algumas palavras.",
        scores,
        notaTotal: 840,
        feedback,
      })
      .returning();

    const [found] = await db.select().from(redacoes).where(eq(redacoes.id, redacao.id));
    expect(found.scores).toEqual(scores);
    expect(found.feedback).toEqual(feedback);
    expect(found.notaTotal).toBe(840);
  });

  it("apaga redações do usuário em cascata quando o usuário é apagado", async () => {
    const testUser = await createTestUser();
    const [tema] = await db
      .insert(temas)
      .values({ id: crypto.randomUUID(), title: `Tema teste ${crypto.randomUUID()}` })
      .returning();

    const [redacao] = await db
      .insert(redacoes)
      .values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        temaId: tema.id,
        text: "Texto de teste.",
        scores: {
          competencia1: 0,
          competencia2: 0,
          competencia3: 0,
          competencia4: 0,
          competencia5: 0,
        },
        notaTotal: 0,
        feedback: { justificativas: ["", "", "", "", ""], comentarioGeral: "" },
      })
      .returning();

    await db.delete(user).where(eq(user.id, testUser.id));

    const remaining = await db.select().from(redacoes).where(eq(redacoes.id, redacao.id));
    expect(remaining).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/schema-redacoes.test.ts`
Expected: FAIL — `temas`/`redacoes` are not exported from `@/db/schema`.

- [ ] **Step 3: Add the tables to `db/schema.ts`**

Append to the end of `db/schema.ts` (after the existing `Simulado` type export):

```ts
export const temas = pgTable("temas", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Tema = typeof temas.$inferSelect;

export type RedacaoScores = {
  competencia1: number;
  competencia2: number;
  competencia3: number;
  competencia4: number;
  competencia5: number;
};

export type RedacaoFeedback = {
  justificativas: string[];
  comentarioGeral: string;
};

export const redacoes = pgTable(
  "redacoes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    temaId: text("tema_id")
      .notNull()
      .references(() => temas.id),
    text: text("text").notNull(),
    scores: jsonb("scores").$type<RedacaoScores>().notNull(),
    notaTotal: integer("nota_total").notNull(),
    feedback: jsonb("feedback").$type<RedacaoFeedback>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("redacoes_userId_idx").on(table.userId),
    index("redacoes_temaId_idx").on(table.temaId),
  ]
);

export type Redacao = typeof redacoes.$inferSelect;
```

- [ ] **Step 4: Generate and run the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/000X_<name>.sql` file is created containing `CREATE TABLE "temas"` and `CREATE TABLE "redacoes"`.

Run: `npm run db:migrate`
Expected: migration applies with no error against the local dev Postgres.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/schema-redacoes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add db/schema.ts drizzle/ tests/schema-redacoes.test.ts
git commit -m "feat: add temas and redacoes tables"
```

---

### Task 2: Anthropic client + grading logic

**Files:**
- Create: `lib/anthropic.ts`
- Create: `lib/redacao.ts`
- Test: `tests/redacao-lib.test.ts`
- Modify: `package.json` (add `@anthropic-ai/sdk` dependency)

**Interfaces:**
- Consumes: `RedacaoScores`, `RedacaoFeedback` types from `@/db/schema` (Task 1).
- Produces: `getAnthropicClient(): Anthropic` and `ANTHROPIC_MODEL: string` from `lib/anthropic.ts`. `gradeRedacao(temaTitle: string, text: string): Promise<{ scores: RedacaoScores; notaTotal: number; feedback: RedacaoFeedback }>` from `lib/redacao.ts` — this is what Task 4's POST route calls.

- [ ] **Step 1: Install the dependency**

Run: `npm install @anthropic-ai/sdk`
Expected: `package.json` gains `"@anthropic-ai/sdk": "^X.X.X"` under `dependencies`.

- [ ] **Step 2: Write `lib/anthropic.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

// Inicialização preguiçosa, mesmo padrão de lib/gemini.ts: evita que importar
// este arquivo quebre em ambientes sem ANTHROPIC_API_KEY (ex: CI, testes que
// mockam este módulo e nunca chegam a construir um client de verdade).
export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY não definida (verifique .env.local)");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export const ANTHROPIC_MODEL = "claude-sonnet-5";
```

- [ ] **Step 3: Write the failing test for `gradeRedacao`**

Create `tests/redacao-lib.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/anthropic", () => ({
  getAnthropicClient: vi.fn(),
  ANTHROPIC_MODEL: "claude-sonnet-5",
}));

import { getAnthropicClient } from "@/lib/anthropic";
import { gradeRedacao } from "@/lib/redacao";

function mockClientWithToolInput(input: Record<string, unknown>) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "tool_use", id: "tool_1", name: "submit_grade", input }],
  });
  vi.mocked(getAnthropicClient).mockReturnValue({
    messages: { create },
  } as unknown as ReturnType<typeof getAnthropicClient>);
  return create;
}

describe("gradeRedacao", () => {
  beforeEach(() => {
    vi.mocked(getAnthropicClient).mockReset();
  });

  it("retorna as notas e soma a nota total corretamente quando a IA responde valores válidos", async () => {
    mockClientWithToolInput({
      competencia1: 200,
      competencia2: 160,
      competencia3: 120,
      competencia4: 200,
      competencia5: 160,
      justificativas: ["a", "b", "c", "d", "e"],
      comentarioGeral: "Muito bom.",
    });

    const result = await gradeRedacao("Tema de teste", "Texto do aluno.");

    expect(result.scores).toEqual({
      competencia1: 200,
      competencia2: 160,
      competencia3: 120,
      competencia4: 200,
      competencia5: 160,
    });
    expect(result.notaTotal).toBe(840);
    expect(result.feedback.justificativas).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.feedback.comentarioGeral).toBe("Muito bom.");
  });

  it("arredonda uma nota fora da rubrica para o valor válido mais próximo", async () => {
    mockClientWithToolInput({
      competencia1: 190, // mais perto de 200 que de 160
      competencia2: 55, // mais perto de 40 que de 80
      competencia3: 0,
      competencia4: 0,
      competencia5: 0,
      justificativas: ["a", "b", "c", "d", "e"],
      comentarioGeral: "",
    });

    const result = await gradeRedacao("Tema de teste", "Texto do aluno.");

    expect(result.scores.competencia1).toBe(200);
    expect(result.scores.competencia2).toBe(40);
  });

  it("lança erro quando a IA não retorna um bloco tool_use", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "desculpe" }] });
    vi.mocked(getAnthropicClient).mockReturnValue({
      messages: { create },
    } as unknown as ReturnType<typeof getAnthropicClient>);

    await expect(gradeRedacao("Tema de teste", "Texto do aluno.")).rejects.toThrow(
      "IA não retornou o schema esperado"
    );
  });

  it("preenche justificativas ausentes com string vazia em vez de quebrar", async () => {
    mockClientWithToolInput({
      competencia1: 0,
      competencia2: 0,
      competencia3: 0,
      competencia4: 0,
      competencia5: 0,
      justificativas: ["só uma"],
      comentarioGeral: "",
    });

    const result = await gradeRedacao("Tema de teste", "Texto do aluno.");
    expect(result.feedback.justificativas).toHaveLength(5);
    expect(result.feedback.justificativas[0]).toBe("só uma");
    expect(result.feedback.justificativas[1]).toBe("");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/redacao-lib.test.ts`
Expected: FAIL — `@/lib/redacao` module does not exist.

- [ ] **Step 5: Write `lib/redacao.ts`**

```ts
import { getAnthropicClient, ANTHROPIC_MODEL } from "@/lib/anthropic";
import type { RedacaoScores, RedacaoFeedback } from "@/db/schema";

const VALID_SCORES = [0, 40, 80, 120, 160, 200];

function clampScore(value: unknown): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return VALID_SCORES.reduce((closest, candidate) =>
    Math.abs(candidate - num) < Math.abs(closest - num) ? candidate : closest
  );
}

// Critérios oficiais das 5 competências do ENEM (informação pública do INEP),
// usados como instrução de sistema para a correção.
const RUBRIC = `Competência 1: domínio da modalidade escrita formal da língua portuguesa.
Competência 2: compreender a proposta e aplicar conceitos de várias áreas de conhecimento para desenvolver o tema, dentro da estrutura do texto dissertativo-argumentativo.
Competência 3: selecionar, relacionar, organizar e interpretar informações, fatos, opiniões e argumentos em defesa de um ponto de vista.
Competência 4: conhecimento dos mecanismos linguísticos necessários para a construção da argumentação.
Competência 5: elaborar proposta de intervenção para o problema abordado, respeitando os direitos humanos.
Cada competência vale exatamente 0, 40, 80, 120, 160 ou 200 pontos - nunca um valor intermediário.`;

export async function gradeRedacao(
  temaTitle: string,
  text: string
): Promise<{ scores: RedacaoScores; notaTotal: number; feedback: RedacaoFeedback }> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 2048,
    system: `Você é um corretor oficial de redações do ENEM. Avalie o texto do aluno segundo as 5 competências oficiais, com rigor e imparcialidade:\n${RUBRIC}`,
    messages: [
      {
        role: "user",
        content: `Tema da redação: "${temaTitle}"\n\nTexto do aluno:\n${text}`,
      },
    ],
    tools: [
      {
        name: "submit_grade",
        description: "Submete a nota da redação nas 5 competências do ENEM.",
        input_schema: {
          type: "object",
          properties: {
            competencia1: { type: "integer", enum: VALID_SCORES },
            competencia2: { type: "integer", enum: VALID_SCORES },
            competencia3: { type: "integer", enum: VALID_SCORES },
            competencia4: { type: "integer", enum: VALID_SCORES },
            competencia5: { type: "integer", enum: VALID_SCORES },
            justificativas: {
              type: "array",
              items: { type: "string" },
              minItems: 5,
              maxItems: 5,
              description: "Uma justificativa curta por competência, na mesma ordem (1 a 5).",
            },
            comentarioGeral: { type: "string" },
          },
          required: [
            "competencia1",
            "competencia2",
            "competencia3",
            "competencia4",
            "competencia5",
            "justificativas",
            "comentarioGeral",
          ],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_grade" },
  });

  const toolUse = response.content.find(
    (block): block is Extract<(typeof response.content)[number], { type: "tool_use" }> =>
      block.type === "tool_use"
  );

  if (!toolUse) {
    throw new Error("IA não retornou o schema esperado");
  }

  const input = toolUse.input as Record<string, unknown>;

  const scores: RedacaoScores = {
    competencia1: clampScore(input.competencia1),
    competencia2: clampScore(input.competencia2),
    competencia3: clampScore(input.competencia3),
    competencia4: clampScore(input.competencia4),
    competencia5: clampScore(input.competencia5),
  };

  const notaTotal =
    scores.competencia1 +
    scores.competencia2 +
    scores.competencia3 +
    scores.competencia4 +
    scores.competencia5;

  const rawJustificativas = Array.isArray(input.justificativas) ? input.justificativas : [];
  const justificativas = Array.from({ length: 5 }, (_, i) =>
    typeof rawJustificativas[i] === "string" ? (rawJustificativas[i] as string) : ""
  );

  const feedback: RedacaoFeedback = {
    justificativas,
    comentarioGeral: typeof input.comentarioGeral === "string" ? input.comentarioGeral : "",
  };

  return { scores, notaTotal, feedback };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/redacao-lib.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/anthropic.ts lib/redacao.ts tests/redacao-lib.test.ts
git commit -m "feat: add Anthropic client and ENEM essay grading logic"
```

---

### Task 3: Seed script for temas

**Files:**
- Create: `scripts/seed-temas.ts`

**Interfaces:**
- Consumes: `temas` table from `@/db/schema` (Task 1), `db` from `@/lib/db`.
- Produces: 5 rows in `temas`, idempotent (safe to run more than once).

- [ ] **Step 1: Write `scripts/seed-temas.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { temas } from "@/db/schema";

// Títulos oficiais de propostas de redação de provas passadas do ENEM
// (informação pública do INEP, mesma base legal já usada para ingerir as
// questões do banco de questões). Só o título - sem os textos motivadores
// completos, que não são reproduzidos aqui.
const SEED_TEMAS = [
  "Desafios para a valorização de comunidades e povos tradicionais no Brasil",
  "Desafios para o enfrentamento da invisibilidade do trabalho de cuidado realizado pela mulher no Brasil",
  "Invisibilidade e registro civil: garantia de acesso à cidadania no Brasil",
  "Democratização do acesso ao cinema no Brasil",
  "Manipulação do comportamento do usuário pelo controle de dados na internet",
];

async function seedTemas() {
  let inserted = 0;
  let skipped = 0;

  for (const title of SEED_TEMAS) {
    const [existing] = await db.select().from(temas).where(eq(temas.title, title));
    if (existing) {
      skipped++;
      continue;
    }
    await db.insert(temas).values({ id: crypto.randomUUID(), title });
    inserted++;
  }

  console.log(`Temas: ${inserted} inseridos, ${skipped} já existiam.`);
}

seedTemas()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Erro ao popular temas:", error);
    process.exit(1);
  });
```

- [ ] **Step 2: Run it against the local dev Postgres**

Run: `npx tsx --env-file=.env.local scripts/seed-temas.ts`
Expected: `Temas: 5 inseridos, 0 já existiam.`

Run it again to confirm idempotency:
Run: `npx tsx --env-file=.env.local scripts/seed-temas.ts`
Expected: `Temas: 0 inseridos, 5 já existiam.`

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-temas.ts
git commit -m "feat: add idempotent seed script for essay themes"
```

---

### Task 4: `GET /api/redacao/temas` and `POST /api/redacao/redacoes`

**Files:**
- Create: `app/api/redacao/temas/route.ts`
- Create: `app/api/redacao/redacoes/route.ts`
- Test: `tests/redacao-temas-api.test.ts`
- Test: `tests/redacao-create-api.test.ts`

**Interfaces:**
- Consumes: `requireUser` from `@/lib/session` (existing), `db` from `@/lib/db` (existing), `temas`/`redacoes` from `@/db/schema` (Task 1), `gradeRedacao` from `@/lib/redacao` (Task 2).
- Produces: `GET /api/redacao/temas` → `200 { temas: { id, title }[] }`. `POST /api/redacao/redacoes` → `200` with the full persisted redação row on success, `400`/`401`/`502` on failure. Task 5's history/detail routes read the same `redacoes` table this task writes to.

- [ ] **Step 1: Write the failing tests for `GET /api/redacao/temas`**

Create `tests/redacao-temas-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { temas } from "@/db/schema";
import { auth } from "@/lib/auth";
import { GET } from "@/app/api/redacao/temas/route";

async function createUserCookie() {
  const email = `aluno-temas-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({ body: { email, password: "senha-segura-123", name: "Aluno" } });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return signIn.headers.get("set-cookie") ?? "";
}

describe("GET /api/redacao/temas", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/redacao/temas");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("retorna a lista de temas com sessão válida", async () => {
    const title = `Tema listagem ${crypto.randomUUID()}`;
    await db.insert(temas).values({ id: crypto.randomUUID(), title });

    const cookie = await createUserCookie();
    const request = new Request("http://localhost:3000/api/redacao/temas", {
      headers: { cookie },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.temas.some((t: { title: string }) => t.title === title)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/redacao-temas-api.test.ts`
Expected: FAIL — `@/app/api/redacao/temas/route` does not exist.

- [ ] **Step 3: Write `app/api/redacao/temas/route.ts`**

```ts
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { temas } from "@/db/schema";

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const rows = await db.select({ id: temas.id, title: temas.title }).from(temas);
  return Response.json({ temas: rows });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/redacao-temas-api.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing tests for `POST /api/redacao/redacoes`**

Create `tests/redacao-create-api.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { redacoes, temas } from "@/db/schema";
import { auth } from "@/lib/auth";

vi.mock("@/lib/redacao", () => ({
  gradeRedacao: vi.fn(),
}));

import { gradeRedacao } from "@/lib/redacao";
import { POST } from "@/app/api/redacao/redacoes/route";

async function createUserCookie() {
  const email = `aluno-redacao-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({ body: { email, password: "senha-segura-123", name: "Aluno" } });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return signIn.headers.get("set-cookie") ?? "";
}

async function createTema() {
  const [tema] = await db
    .insert(temas)
    .values({ id: crypto.randomUUID(), title: `Tema criação ${crypto.randomUUID()}` })
    .returning();
  return tema;
}

const LONG_ENOUGH_TEXT = Array.from({ length: 60 }, () => "palavra").join(" ");

describe("POST /api/redacao/redacoes", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/redacao/redacoes", {
      method: "POST",
      body: JSON.stringify({ temaId: "x", text: LONG_ENOUGH_TEXT }),
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("retorna 400 quando o texto tem menos de 50 palavras", async () => {
    const cookie = await createUserCookie();
    const tema = await createTema();
    const request = new Request("http://localhost:3000/api/redacao/redacoes", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ temaId: tema.id, text: "texto curto demais" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("retorna 400 para temaId inexistente", async () => {
    const cookie = await createUserCookie();
    const request = new Request("http://localhost:3000/api/redacao/redacoes", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ temaId: crypto.randomUUID(), text: LONG_ENOUGH_TEXT }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("corrige e grava a redação quando a IA responde com sucesso", async () => {
    const cookie = await createUserCookie();
    const tema = await createTema();
    vi.mocked(gradeRedacao).mockResolvedValue({
      scores: {
        competencia1: 200,
        competencia2: 160,
        competencia3: 120,
        competencia4: 200,
        competencia5: 160,
      },
      notaTotal: 840,
      feedback: { justificativas: ["a", "b", "c", "d", "e"], comentarioGeral: "Bom." },
    });

    const request = new Request("http://localhost:3000/api/redacao/redacoes", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ temaId: tema.id, text: LONG_ENOUGH_TEXT }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.notaTotal).toBe(840);

    const saved = await db.select().from(redacoes).where(eq(redacoes.temaId, tema.id));
    expect(saved).toHaveLength(1);
    expect(saved[0].notaTotal).toBe(840);
  });

  it("retorna 502 e não grava nada quando a IA falha", async () => {
    const cookie = await createUserCookie();
    const tema = await createTema();
    vi.mocked(gradeRedacao).mockRejectedValue(new Error("timeout"));

    const request = new Request("http://localhost:3000/api/redacao/redacoes", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ temaId: tema.id, text: LONG_ENOUGH_TEXT }),
    });
    const response = await POST(request);
    expect(response.status).toBe(502);

    const saved = await db.select().from(redacoes).where(eq(redacoes.temaId, tema.id));
    expect(saved).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/redacao-create-api.test.ts`
Expected: FAIL — `@/app/api/redacao/redacoes/route` does not exist.

- [ ] **Step 7: Write `app/api/redacao/redacoes/route.ts`**

```ts
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { redacoes, temas } from "@/db/schema";
import { gradeRedacao } from "@/lib/redacao";

const MIN_WORDS = 50;
const MAX_CHARS = 3000;

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

  const { temaId, text } = body as Record<string, unknown>;

  if (typeof temaId !== "string" || typeof text !== "string") {
    return Response.json({ error: "temaId e text são obrigatórios" }, { status: 400 });
  }

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_WORDS) {
    return Response.json(
      { error: `O texto precisa ter pelo menos ${MIN_WORDS} palavras` },
      { status: 400 }
    );
  }
  if (text.length > MAX_CHARS) {
    return Response.json(
      { error: `O texto não pode passar de ${MAX_CHARS} caracteres` },
      { status: 400 }
    );
  }

  const [tema] = await db.select().from(temas).where(eq(temas.id, temaId));
  if (!tema) {
    return Response.json({ error: "Tema não encontrado" }, { status: 400 });
  }

  let graded: Awaited<ReturnType<typeof gradeRedacao>>;
  try {
    graded = await gradeRedacao(tema.title, text);
  } catch {
    return Response.json({ error: "Falha ao corrigir a redação. Tente novamente." }, { status: 502 });
  }

  const [saved] = await db
    .insert(redacoes)
    .values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      temaId: tema.id,
      text,
      scores: graded.scores,
      notaTotal: graded.notaTotal,
      feedback: graded.feedback,
    })
    .returning();

  return Response.json(saved);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/redacao-create-api.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add app/api/redacao/temas/route.ts app/api/redacao/redacoes/route.ts tests/redacao-temas-api.test.ts tests/redacao-create-api.test.ts
git commit -m "feat: add temas listing and essay grading API routes"
```

---

### Task 5: History and detail routes

**Files:**
- Create: `app/api/redacao/redacoes/[id]/route.ts`
- Modify: `app/api/redacao/redacoes/route.ts` (add `GET` alongside the existing `POST`)
- Test: `tests/redacao-history-api.test.ts`
- Test: `tests/redacao-detail-api.test.ts`

**Interfaces:**
- Consumes: `redacoes`, `temas` from `@/db/schema` (Task 1), `requireUser` (existing).
- Produces: `GET /api/redacao/redacoes?page=N` → `200 { redacoes: {id, temaId, temaTitle, notaTotal, createdAt}[], page, pageSize, total }`. `GET /api/redacao/redacoes/[id]` → `200` full redação (404 if missing or not owned by the caller).

- [ ] **Step 1: Write the failing test for the history route**

Create `tests/redacao-history-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { redacoes, temas } from "@/db/schema";
import { auth } from "@/lib/auth";
import { GET } from "@/app/api/redacao/redacoes/route";

async function createUserCookie() {
  const email = `aluno-historico-${crypto.randomUUID()}@example.com`;
  const signUp = await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Aluno" },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return { cookie: signIn.headers.get("set-cookie") ?? "", userId: signUp.user.id };
}

async function createGradedRedacao(userId: string) {
  const [tema] = await db
    .insert(temas)
    .values({ id: crypto.randomUUID(), title: `Tema histórico ${crypto.randomUUID()}` })
    .returning();

  const [redacao] = await db
    .insert(redacoes)
    .values({
      id: crypto.randomUUID(),
      userId,
      temaId: tema.id,
      text: "Texto de teste.",
      scores: {
        competencia1: 200,
        competencia2: 200,
        competencia3: 200,
        competencia4: 200,
        competencia5: 200,
      },
      notaTotal: 1000,
      feedback: { justificativas: ["", "", "", "", ""], comentarioGeral: "" },
    })
    .returning();

  return { redacao, tema };
}

describe("GET /api/redacao/redacoes", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/redacao/redacoes");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("retorna só as redações do próprio usuário, com o título do tema", async () => {
    const { cookie, userId } = await createUserCookie();
    const { redacao, tema } = await createGradedRedacao(userId);

    const otherUser = await createUserCookie();
    await createGradedRedacao(otherUser.userId);

    const request = new Request("http://localhost:3000/api/redacao/redacoes", {
      headers: { cookie },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.redacoes.some((r: { id: string }) => r.id === redacao.id)).toBe(true);
    const found = body.redacoes.find((r: { id: string }) => r.id === redacao.id);
    expect(found.temaTitle).toBe(tema.title);
    expect(
      body.redacoes.every((r: { id: string }) => r.id !== otherUser.userId)
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/redacao-history-api.test.ts`
Expected: FAIL — `GET` is not exported from `@/app/api/redacao/redacoes/route`.

- [ ] **Step 3: Add `GET` to `app/api/redacao/redacoes/route.ts`**

Add these imports at the top (merge with the existing `eq` import from `drizzle-orm`):

```ts
import { and, count, desc, eq } from "drizzle-orm";
```

Use just:

```ts
import { count, desc, eq } from "drizzle-orm";
```

Add below the existing `POST` export in the same file:

```ts
const PAGE_SIZE = 20;

function parsePage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) {
    return 1;
  }
  const parsed = Number(value);
  return parsed >= 1 ? parsed : 1;
}

export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const page = parsePage(url.searchParams.get("page"));

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(redacoes)
    .where(eq(redacoes.userId, session.user.id));

  const rows = await db
    .select({
      id: redacoes.id,
      temaId: redacoes.temaId,
      temaTitle: temas.title,
      notaTotal: redacoes.notaTotal,
      createdAt: redacoes.createdAt,
    })
    .from(redacoes)
    .innerJoin(temas, eq(redacoes.temaId, temas.id))
    .where(eq(redacoes.userId, session.user.id))
    .orderBy(desc(redacoes.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return Response.json({ redacoes: rows, page, pageSize: PAGE_SIZE, total });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/redacao-history-api.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for the detail route**

Create `tests/redacao-detail-api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { redacoes, temas } from "@/db/schema";
import { auth } from "@/lib/auth";
import { GET } from "@/app/api/redacao/redacoes/[id]/route";

async function createUserCookie() {
  const email = `aluno-detalhe-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({ body: { email, password: "senha-segura-123", name: "Aluno" } });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return signIn.headers.get("set-cookie") ?? "";
}

async function createTema() {
  const [tema] = await db
    .insert(temas)
    .values({ id: crypto.randomUUID(), title: `Tema detalhe ${crypto.randomUUID()}` })
    .returning();
  return tema;
}

describe("GET /api/redacao/redacoes/[id]", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/redacao/redacoes/abc");
    const response = await GET(request, { params: Promise.resolve({ id: "abc" }) });
    expect(response.status).toBe(401);
  });

  it("retorna 404 para id inexistente", async () => {
    const cookie = await createUserCookie();
    const request = new Request("http://localhost:3000/api/redacao/redacoes/abc", {
      headers: { cookie },
    });
    const response = await GET(request, { params: Promise.resolve({ id: crypto.randomUUID() }) });
    expect(response.status).toBe(404);
  });

  it("retorna 404 quando a redação pertence a outro usuário", async () => {
    const tema = await createTema();

    let ownerUserId = "";
    {
      const email = `dono-${crypto.randomUUID()}@example.com`;
      const signUp = await auth.api.signUpEmail({
        body: { email, password: "senha-segura-123", name: "Dono" },
      });
      ownerUserId = signUp.user.id;
    }

    const [redacao] = await db
      .insert(redacoes)
      .values({
        id: crypto.randomUUID(),
        userId: ownerUserId,
        temaId: tema.id,
        text: "Texto.",
        scores: {
          competencia1: 0,
          competencia2: 0,
          competencia3: 0,
          competencia4: 0,
          competencia5: 0,
        },
        notaTotal: 0,
        feedback: { justificativas: ["", "", "", "", ""], comentarioGeral: "" },
      })
      .returning();

    const otherCookie = await createUserCookie();
    const request = new Request(`http://localhost:3000/api/redacao/redacoes/${redacao.id}`, {
      headers: { cookie: otherCookie },
    });
    const response = await GET(request, { params: Promise.resolve({ id: redacao.id }) });
    expect(response.status).toBe(404);
  });

  it("retorna a redação completa para o dono", async () => {
    const email = `dono2-${crypto.randomUUID()}@example.com`;
    const signUp = await auth.api.signUpEmail({
      body: { email, password: "senha-segura-123", name: "Dono" },
    });
    const signIn = await auth.api.signInEmail({
      body: { email, password: "senha-segura-123" },
      asResponse: true,
    });
    const cookie = signIn.headers.get("set-cookie") ?? "";

    const [tema] = await db
      .insert(temas)
      .values({ id: crypto.randomUUID(), title: `Tema detalhe dono ${crypto.randomUUID()}` })
      .returning();

    const [redacao] = await db
      .insert(redacoes)
      .values({
        id: crypto.randomUUID(),
        userId: signUp.user.id,
        temaId: tema.id,
        text: "Texto completo.",
        scores: {
          competencia1: 200,
          competencia2: 200,
          competencia3: 200,
          competencia4: 200,
          competencia5: 200,
        },
        notaTotal: 1000,
        feedback: { justificativas: ["a", "b", "c", "d", "e"], comentarioGeral: "Perfeito." },
      })
      .returning();

    const request = new Request(`http://localhost:3000/api/redacao/redacoes/${redacao.id}`, {
      headers: { cookie },
    });
    const response = await GET(request, { params: Promise.resolve({ id: redacao.id }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.notaTotal).toBe(1000);
    expect(body.text).toBe("Texto completo.");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/redacao-detail-api.test.ts`
Expected: FAIL — `@/app/api/redacao/redacoes/[id]/route` does not exist.

- [ ] **Step 7: Write `app/api/redacao/redacoes/[id]/route.ts`**

```ts
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { redacoes } from "@/db/schema";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;

  const [redacao] = await db
    .select()
    .from(redacoes)
    .where(and(eq(redacoes.id, id), eq(redacoes.userId, session.user.id)));

  if (!redacao) {
    return Response.json({ error: "Redação não encontrada" }, { status: 404 });
  }

  return Response.json(redacao);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/redacao-detail-api.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add app/api/redacao/redacoes/route.ts app/api/redacao/redacoes/[id]/route.ts tests/redacao-history-api.test.ts tests/redacao-detail-api.test.ts
git commit -m "feat: add essay history and detail API routes"
```

---

### Task 6: `/redacao` and `/redacao/historico` pages

**Files:**
- Create: `app/redacao/page.tsx`
- Create: `app/redacao/historico/page.tsx`

**Interfaces:**
- Consumes: `GET /api/redacao/temas` (Task 4), `GET /api/redacao/redacoes` (Task 5).

- [ ] **Step 1: Write `app/redacao/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Tema = { id: string; title: string };

export default function RedacaoPage() {
  const router = useRouter();
  const [temas, setTemas] = useState<Tema[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/redacao/temas")
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar temas. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || data === null) return;
        setTemas(data.temas);
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
        <h1 className="text-2xl font-semibold">Redação</h1>
        <Button render={<Link href="/redacao/historico">Meu histórico</Link>} variant="link" />
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!temas && !error && <p>Carregando...</p>}
      {temas && temas.length === 0 && (
        <p className="text-muted-foreground">Nenhum tema disponível ainda.</p>
      )}

      {temas && temas.length > 0 && (
        <div className="flex flex-col gap-3">
          {temas.map((tema) => (
            <Link key={tema.id} href={`/redacao/${tema.id}`}>
              <Card>
                <CardHeader>
                  <p className="font-medium">{tema.title}</p>
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

- [ ] **Step 2: Write `app/redacao/historico/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

type RedacaoResumo = {
  id: string;
  temaTitle: string;
  notaTotal: number;
  createdAt: string;
};

function HistoricoContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = Number(searchParams.get("page") ?? "1") || 1;

  const [redacoes, setRedacoes] = useState<RedacaoResumo[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/redacao/redacoes?page=${page}`)
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
        setRedacoes(data.redacoes);
        setTotal(data.total);
        setPageSize(data.pageSize);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [router, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Meu histórico de redações</h1>

      {error && <p className="text-destructive">{error}</p>}
      {!redacoes && !error && <p>Carregando...</p>}
      {redacoes && redacoes.length === 0 && (
        <p className="text-muted-foreground">Você ainda não escreveu nenhuma redação.</p>
      )}

      {redacoes && redacoes.length > 0 && (
        <div className="flex flex-col gap-3">
          {redacoes.map((r) => (
            <Link key={r.id} href={`/redacao/resultado/${r.id}`}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <p className="font-medium">{r.temaTitle}</p>
                  <p className="text-sm text-muted-foreground">{r.notaTotal} / 1000</p>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {redacoes && totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href={`/redacao/historico?page=${Math.max(1, page - 1)}`} />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink href={`/redacao/historico?page=${p}`} isActive={p === page}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext href={`/redacao/historico?page=${Math.min(totalPages, page + 1)}`} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </main>
  );
}

export default function HistoricoPage() {
  return (
    <Suspense fallback={<p className="px-4 py-8">Carregando...</p>}>
      <HistoricoContent />
    </Suspense>
  );
}
```

Note: `useSearchParams()` requires a `<Suspense>` boundary or `next build` fails with a prerender error — this is a documented project-wide gotcha from the redesign-admin subsystem, confirmed empirically there. Verify `components/ui/pagination.tsx` exports `Pagination`, `PaginationContent`, `PaginationItem`, `PaginationLink`, `PaginationNext`, `PaginationPrevious` (it does — same component `/admin/revisao` already uses).

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, sign in, open `/redacao` — confirm the seeded temas render as cards. Open `/redacao/historico` — confirm it renders "Você ainda não escreveu nenhuma redação." for a fresh user.

- [ ] **Step 4: Commit**

```bash
git add app/redacao/page.tsx app/redacao/historico/page.tsx
git commit -m "feat: add redação theme list and history pages"
```

---

### Task 7: Writing page and result page

**Files:**
- Create: `app/redacao/[temaId]/page.tsx`
- Create: `app/redacao/resultado/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/redacao/temas` (filtered client-side by id — no single-tema GET route exists, matching YAGNI: the list is already fetched once and small), `POST /api/redacao/redacoes` (Task 4), `GET /api/redacao/redacoes/[id]` (Task 5).

- [ ] **Step 1: Write `app/redacao/[temaId]/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const MIN_WORDS = 50;
const MAX_CHARS = 3000;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export default function EscreverRedacaoPage() {
  const params = useParams<{ temaId: string }>();
  const router = useRouter();
  const [temaTitle, setTemaTitle] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/redacao/temas")
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || data === null) return;
        const tema = data.temas.find((t: { id: string }) => t.id === params.temaId);
        setTemaTitle(tema ? tema.title : null);
      });
    return () => {
      cancelled = true;
    };
  }, [router, params.temaId]);

  const wordCount = countWords(text);
  const canSubmit = wordCount >= MIN_WORDS && text.length <= MAX_CHARS && !submitting;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/redacao/redacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temaId: params.temaId, text }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Erro ao corrigir a redação." }));
        throw new Error(body.error ?? "Erro ao corrigir a redação.");
      }
      const redacao = await response.json();
      router.push(`/redacao/resultado/${redacao.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao corrigir a redação.");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">{temaTitle ?? "Carregando tema..."}</h1>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Escreva sua redação aqui..."
        rows={20}
        disabled={submitting}
      />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {wordCount} palavra{wordCount === 1 ? "" : "s"} (mínimo {MIN_WORDS})
        </span>
        <span>
          {text.length} / {MAX_CHARS} caracteres
        </span>
      </div>

      {error && <p className="text-destructive">{error}</p>}

      <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
        {submitting ? "Corrigindo... isso pode levar alguns segundos" : "Enviar para correção"}
      </Button>
    </main>
  );
}
```

- [ ] **Step 2: Write `app/redacao/resultado/[id]/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type RedacaoDetalhe = {
  id: string;
  text: string;
  notaTotal: number;
  scores: {
    competencia1: number;
    competencia2: number;
    competencia3: number;
    competencia4: number;
    competencia5: number;
  };
  feedback: { justificativas: string[]; comentarioGeral: string };
};

const COMPETENCIA_LABELS = [
  "Competência 1 — Norma culta",
  "Competência 2 — Compreensão do tema",
  "Competência 3 — Argumentação",
  "Competência 4 — Coesão e coerência",
  "Competência 5 — Proposta de intervenção",
];

export default function ResultadoRedacaoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [redacao, setRedacao] = useState<RedacaoDetalhe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/redacao/redacoes/${params.id}`)
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (response.status === 404) {
          throw new Error("Redação não encontrada.");
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar a redação.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || data === null) return;
        setRedacao(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [router, params.id]);

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-destructive">{error}</p>
      </main>
    );
  }

  if (!redacao) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <p>Carregando...</p>
      </main>
    );
  }

  const scores = [
    redacao.scores.competencia1,
    redacao.scores.competencia2,
    redacao.scores.competencia3,
    redacao.scores.competencia4,
    redacao.scores.competencia5,
  ];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Resultado</h1>
        <Badge className="text-lg">{redacao.notaTotal} / 1000</Badge>
      </div>

      <div className="flex flex-col gap-3">
        {COMPETENCIA_LABELS.map((label, i) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between">
              <p className="font-medium">{label}</p>
              <Badge variant="outline">{scores[i]} / 200</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{redacao.feedback.justificativas[i]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {redacao.feedback.comentarioGeral && (
        <Card>
          <CardHeader>
            <p className="font-medium">Comentário geral</p>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{redacao.feedback.comentarioGeral}</p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Manual verification**

With `npm run dev` running: open `/redacao`, click a tema, type 50+ words, submit. Since no real `ANTHROPIC_API_KEY` exists in this environment, this call will fail with a 502 — confirm the UI shows the error message and does not crash. This is expected and matches the spec's documented external blocker; full success-path verification happens once a real key is configured (see final task).

- [ ] **Step 4: Commit**

```bash
git add app/redacao/[temaId]/page.tsx app/redacao/resultado/[id]/page.tsx
git commit -m "feat: add redação writing and result pages"
```

---

### Task 8: Navigation entry point and route protection

**Files:**
- Modify: `app/components/Header.tsx`
- Modify: `middleware.ts`
- Modify: `tests/middleware.test.ts`

**Interfaces:**
- None new — this wires existing pieces into the app shell, closing the "feature built but undiscoverable" gap that hit subsystem 3 (Prática) before its final review.

- [ ] **Step 1: Add the nav link to `Header.tsx`**

In `app/components/Header.tsx`, add a "Redação" link next to the existing "Praticar" and "Simulados" links:

```tsx
<Button render={<Link href="/pratica">Praticar</Link>} variant="link" />
<Button render={<Link href="/simulados">Simulados</Link>} variant="link" />
<Button render={<Link href="/redacao">Redação</Link>} variant="link" />
```

- [ ] **Step 2: Read the current middleware test for the matcher assertion**

Open `tests/middleware.test.ts` and find the existing assertion(s) checking `config.matcher` (mirrors the pattern used when `/simulados/:path*` and `/pratica/:path*` were added). Add an equivalent assertion for `/redacao/:path*` following the same style already in that file.

- [ ] **Step 3: Add `/redacao/:path*` to the middleware matcher**

In `middleware.ts`, change:

```ts
export const config = {
  matcher: ["/api/:path*", "/admin/:path*", "/pratica/:path*", "/simulados/:path*"],
};
```

to:

```ts
export const config = {
  matcher: ["/api/:path*", "/admin/:path*", "/pratica/:path*", "/simulados/:path*", "/redacao/:path*"],
};
```

Also update the comment above `middleware()` and the one above `config` that enumerate protected route prefixes, so they mention `/redacao/*` too (matching the existing style of keeping that comment in sync — do not leave it stale, a stale version of exactly this comment was flagged in a previous subsystem's review).

- [ ] **Step 4: Run the middleware test**

Run: `npx vitest run tests/middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Full local verification**

Run in order:

```bash
npm run lint
npx next build
npx tsc --noEmit
npx vitest run
```

Expected: all four succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add app/components/Header.tsx middleware.ts tests/middleware.test.ts
git commit -m "feat: add redação nav link and route protection"
```

---

## After all tasks: what remains manual

1. **Add a real `ANTHROPIC_API_KEY`** to `.env.local` (dev) and to the Vercel project's environment variables (production) — this environment has none, and it is the one input only the account owner can provide. Until it's set, `POST /api/redacao/redacoes` will always return 502.
2. **Once the key is set**, manually drive one real submission through the browser (sign in → `/redacao` → pick a tema → write 50+ words → submit → confirm real scores render on `/redacao/resultado/[id]`) to confirm the live Claude integration actually works end-to-end — the automated tests only prove the surrounding logic is correct against a mocked client, not that the real prompt/schema pairing produces a valid response from the real API.
3. Run `/pr-audit` before merging to `main`, matching every prior subsystem's process.
