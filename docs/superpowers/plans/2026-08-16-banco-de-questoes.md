# Banco de Questões + Curadoria Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ENEM question bank: a local ingestion script that downloads real ENEM 2025 exam PDFs, extracts and classifies each question via Gemini, and a protected admin screen in the Next.js app to review and approve questions before they become usable by the rest of the platform.

**Architecture:** Two independent pieces sharing one Postgres database. (1) A local Node/TypeScript script (`scripts/ingest/`, run manually, not deployed) downloads the official INEP PDFs, sends each day's full exam PDF to Gemini in one call to get back a structured JSON array of all its questions (statement, alternatives, suggested classification, image flag), cross-references the official gabarito PDF (also via one Gemini call) for the correct answer, renders a page-image for questions that have a figure and uploads it to Supabase Storage, then inserts everything into Postgres with `status: "pendente"`. (2) An admin-only route inside the existing Next.js app (`/admin/revisao`) lists pending questions and lets the founder approve, edit, or reject them.

**Tech Stack:** `@google/genai` (Gemini SDK), `@supabase/supabase-js` (Storage), `pdf-to-img` (page-to-image rendering, only for questions with a figure), Drizzle ORM (existing), Next.js App Router (existing), Better Auth `additionalFields` (existing auth, extended with a `role` field).

## Global Constraints

- Rota admin protegida com o mesmo padrão de defesa em profundidade já estabelecido: middleware verifica sessão presente; a própria rota valida `role: admin` no servidor antes de qualquer leitura/escrita (spec: Segurança)
- `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_URL` só em `.env.local`, nunca commitados (spec: Segurança) — mesmo padrão já usado para `DATABASE_URL`/`BETTER_AUTH_SECRET`
- Script de ingestão roda localmente, nunca como rota pública (spec: Segurança)
- Restrição de unicidade em `(year, examDay, questionNumber)` — script deve pular questão já existente em qualquer status ao rodar de novo (spec: Pipeline de ingestão, passo 7)
- Alternativas sempre exatamente 5 (A–E), guardadas juntas em JSONB (spec: Modelo de dados)
- TypeScript em todo o código novo (herdado da Fundação, Restrições Globais)
- ORM com queries parametrizadas — nunca SQL concatenado na mão (herdado da Fundação)

---

## File Structure

```
plataforma-enem/
  db/
    schema.ts                       # MODIFY: adiciona role em user, novas tabelas topics/questions
  lib/
    admin.ts                        # NOVO: requireAdmin(request) — validação server-side
    gemini.ts                       # NOVO: cliente @google/genai compartilhado
  scripts/
    ingest/
      config.ts                     # NOVO: ano alvo, URLs dos PDFs do INEP (descobertas na Task 3)
      types.ts                      # NOVO: tipos compartilhados (ExtractedQuestion, GabaritoEntry)
      download.ts                   # NOVO: downloadPdf()
      extract-questions.ts          # NOVO: extractQuestionsFromPdf() via Gemini
      extract-gabarito.ts           # NOVO: extractGabaritoFromPdf() + mergeGabarito()
      idempotency.ts                # NOVO: questionAlreadyExists() — função pura, testável
      images.ts                     # NOVO: renderPageImage() + uploadQuestionImage()
      topics.ts                     # NOVO: findOrCreateTopic()
      run.ts                        # NOVO: orquestrador — ponto de entrada do script
  app/
    admin/
      revisao/
        page.tsx                    # NOVO: tela de revisão (lista + ações)
    api/
      admin/
        questions/
          route.ts                  # NOVO: GET lista de questões pendentes
          [id]/
            route.ts                # NOVO: PATCH aprovar/editar/rejeitar
  tests/
    admin.test.ts                   # NOVO: testes de requireAdmin
    ingest/
      idempotency.test.ts           # NOVO: teste da função pura
    admin-questions-api.test.ts     # NOVO: testes das rotas /api/admin/questions
  README.md                         # MODIFY: seção "Curadoria de questões"
  .env.example                      # MODIFY: adiciona as 3 novas variáveis
```

---

### Task 1: Schema — tabelas `topics`, `questions` e papel de admin

**Files:**
- Modify: `db/schema.ts`
- Modify: `lib/auth.ts`
- Test: `tests/schema-questoes.test.ts`

**Interfaces:**
- Consumes: `db` de `lib/db.ts`, `user` de `db/schema.ts` (já existentes)
- Produces: `topics` (pgTable), `questions` (pgTable), tipo `Topic`, tipo `Question`, coluna `user.role` (`"aluno" | "admin"`, padrão `"aluno"`)

- [ ] **Step 1: Escrever o teste que falha**

Create `tests/schema-questoes.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user, topics, questions } from "@/db/schema";

describe("schema de questões", () => {
  it("cria um topic e uma question referenciando ele", async () => {
    const [topic] = await db
      .insert(topics)
      .values({
        id: crypto.randomUUID(),
        area: "natureza",
        subject: "Física",
        name: "Óptica — Lentes",
      })
      .returning();

    const [question] = await db
      .insert(questions)
      .values({
        id: crypto.randomUUID(),
        year: 2025,
        examDay: 2,
        questionNumber: 91,
        area: "natureza",
        statement: "Uma lente convexa...",
        alternatives: [
          { letter: "A", text: "..." },
          { letter: "B", text: "..." },
          { letter: "C", text: "..." },
          { letter: "D", text: "..." },
          { letter: "E", text: "..." },
        ],
        correctAnswer: "C",
        topicId: topic.id,
        status: "pendente",
      })
      .returning();

    expect(question.topicId).toBe(topic.id);
    expect(question.status).toBe("pendente");
    expect(question.alternatives).toHaveLength(5);
  });

  it("rejeita duas questões com o mesmo ano+dia+número", async () => {
    const topicId = crypto.randomUUID();
    await db.insert(topics).values({
      id: topicId,
      area: "matematica",
      subject: "Matemática",
      name: "Geometria",
    });

    const base = {
      year: 2099,
      examDay: 1 as const,
      questionNumber: 1,
      area: "matematica" as const,
      statement: "x",
      alternatives: [
        { letter: "A", text: "1" },
        { letter: "B", text: "2" },
        { letter: "C", text: "3" },
        { letter: "D", text: "4" },
        { letter: "E", text: "5" },
      ],
      correctAnswer: "A",
      topicId,
      status: "pendente" as const,
    };

    await db.insert(questions).values({ id: crypto.randomUUID(), ...base });

    await expect(
      db.insert(questions).values({ id: crypto.randomUUID(), ...base })
    ).rejects.toThrow();
  });

  it("user tem role padrão 'aluno' e aceita 'admin'", async () => {
    const [created] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: "Aluno Teste",
        email: `aluno-${crypto.randomUUID()}@example.com`,
        emailVerified: false,
      })
      .returning();
    expect(created.role).toBe("aluno");

    await db.update(user).set({ role: "admin" }).where(eq(user.id, created.id));
    const [updated] = await db.select().from(user).where(eq(user.id, created.id));
    expect(updated.role).toBe("admin");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/schema-questoes.test.ts`
Expected: FAIL — `topics`/`questions` não existem em `@/db/schema`, e `role` não existe em `user`

- [ ] **Step 3: Adicionar as novas tabelas e a coluna `role`**

Modify `db/schema.ts` — adicione os imports necessários no topo (mantendo os já existentes) e o campo `role` na definição de `user`:

```typescript
import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["aluno", "admin"]);
```

No `pgTable("user", { ... })` existente, adicione o campo `role` (não remova nada que já está lá):

```typescript
  role: userRole("role").default("aluno").notNull(),
```

Ao final do arquivo (depois das tabelas do Better Auth já existentes), adicione:

```typescript
export const examArea = pgEnum("exam_area", [
  "linguagens",
  "humanas",
  "natureza",
  "matematica",
]);

export const questionStatus = pgEnum("question_status", [
  "pendente",
  "aprovada",
  "rejeitada",
]);

export const topics = pgTable("topics", {
  id: text("id").primaryKey(),
  area: examArea("area").notNull(),
  subject: text("subject").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Alternative = { letter: string; text: string };

export const questions = pgTable(
  "questions",
  {
    id: text("id").primaryKey(),
    year: integer("year").notNull(),
    examDay: integer("exam_day").notNull(),
    questionNumber: integer("question_number").notNull(),
    area: examArea("area").notNull(),
    statement: text("statement").notNull(),
    alternatives: jsonb("alternatives").$type<Alternative[]>().notNull(),
    correctAnswer: text("correct_answer").notNull(),
    imageUrl: text("image_url"),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id),
    status: questionStatus("status").default("pendente").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique("questions_year_day_number_unique").on(
      table.year,
      table.examDay,
      table.questionNumber
    ),
    index("questions_topic_idx").on(table.topicId),
    index("questions_status_idx").on(table.status),
  ]
);

export const questionsRelations = relations(questions, ({ one }) => ({
  topic: one(topics, {
    fields: [questions.topicId],
    references: [topics.id],
  }),
}));
```

- [ ] **Step 4: Registrar `role` como campo adicional no Better Auth**

Modify `lib/auth.ts` — dentro da chamada `betterAuth({ ... })`, adicione (ao lado das opções já existentes, como `session`):

```typescript
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "aluno",
        input: false,
      },
    },
  },
```

`input: false` impede que o próprio usuário defina seu papel via cadastro/atualização de perfil — só é alterado diretamente no banco.

- [ ] **Step 5: Gerar e aplicar a migração**

Run: `npx drizzle-kit generate`
Expected: novo arquivo SQL em `drizzle/` com `CREATE TYPE`/`ALTER TABLE` para `user.role` e `CREATE TABLE` para `topics`/`questions`

Certifique-se que o Postgres local está rodando (`docker compose ps`; `docker compose up -d` se necessário).

Run: `npx drizzle-kit migrate`
Expected: saída confirmando que a migração foi aplicada

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/schema-questoes.test.ts`
Expected: PASS — 3 testes passando

- [ ] **Step 7: Commit**

```bash
git add db/schema.ts lib/auth.ts drizzle/ tests/schema-questoes.test.ts
git commit -m "feat: add topics/questions tables and user role"
```

---

### Task 2: Autorização de admin (`requireAdmin`)

**Files:**
- Create: `lib/admin.ts`
- Test: `tests/admin.test.ts`

**Interfaces:**
- Consumes: `auth` de `lib/auth.ts` (Task 1 já estende com `role`)
- Produces: `requireAdmin(request: Request): Promise<{ user: { id: string; email: string; role: string } } | null>` — retorna a sessão se o usuário estiver autenticado E for admin; `null` caso contrário

- [ ] **Step 1: Escrever o teste que falha**

Create `tests/admin.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";

describe("requireAdmin", () => {
  it("retorna null sem sessão", async () => {
    const request = new Request("http://localhost:3000/admin/revisao");
    const result = await requireAdmin(request);
    expect(result).toBeNull();
  });

  it("retorna null para usuário autenticado sem role admin", async () => {
    const email = `aluno-${crypto.randomUUID()}@example.com`;
    await auth.api.signUpEmail({
      body: { email, password: "senha-segura-123", name: "Aluno" },
    });
    const signIn = await auth.api.signInEmail({
      body: { email, password: "senha-segura-123" },
      asResponse: true,
    });
    const cookie = signIn.headers.get("set-cookie") ?? "";

    const request = new Request("http://localhost:3000/admin/revisao", {
      headers: { cookie },
    });
    const result = await requireAdmin(request);
    expect(result).toBeNull();
  });

  it("retorna a sessão para usuário admin", async () => {
    const email = `admin-${crypto.randomUUID()}@example.com`;
    const signUp = await auth.api.signUpEmail({
      body: { email, password: "senha-segura-123", name: "Admin" },
    });
    await db.update(user).set({ role: "admin" }).where(eq(user.id, signUp.user.id));

    const signIn = await auth.api.signInEmail({
      body: { email, password: "senha-segura-123" },
      asResponse: true,
    });
    const cookie = signIn.headers.get("set-cookie") ?? "";

    const request = new Request("http://localhost:3000/admin/revisao", {
      headers: { cookie },
    });
    const result = await requireAdmin(request);
    expect(result).not.toBeNull();
    expect(result!.user.email).toBe(email);
    expect(result!.user.role).toBe("admin");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/admin.test.ts`
Expected: FAIL — `Cannot find module '@/lib/admin'`

- [ ] **Step 3: Implementar `lib/admin.ts`**

Create `lib/admin.ts`:

```typescript
import { auth } from "@/lib/auth";

export async function requireAdmin(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return null;
  }

  const role = (session.user as { role?: string }).role;
  if (role !== "admin") {
    return null;
  }

  return { user: { id: session.user.id, email: session.user.email, role } };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/admin.test.ts`
Expected: PASS — 3 testes passando

Se o segundo teste (`role`) não vier populado em `session.user`, verifique se `lib/auth.ts` (Task 1, Step 4) tem `user.additionalFields.role` configurado — sem isso, o Better Auth não inclui o campo customizado na sessão.

- [ ] **Step 5: Commit**

```bash
git add lib/admin.ts tests/admin.test.ts
git commit -m "feat: add requireAdmin session/role check"
```

---

### Task 3: Descobrir e baixar os PDFs oficiais do INEP

**Files:**
- Create: `scripts/ingest/config.ts`
- Create: `scripts/ingest/download.ts`

**Interfaces:**
- Produces: `INGEST_YEAR: number`, `PDF_URLS: { day1Exam: string; day1Gabarito: string; day2Exam: string; day2Gabarito: string }`, `downloadPdf(url: string, destPath: string): Promise<string>` (retorna o caminho do arquivo salvo)

- [ ] **Step 1: Descobrir as URLs reais dos PDFs de 2025**

As URLs exatas dos PDFs do INEP não são fixas o bastante para cravar sem checar — confirme antes de codificar. Acesse `https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem/provas-e-gabaritos/2025` (use o `WebFetch` ou abra no navegador) e localize os links diretos de download para:
- Prova do 1º dia (qualquer variante de cor/caderno — todas têm as mesmas questões em ordem diferente; escolha uma, ex: a azul/caderno 1)
- Gabarito do 1º dia
- Prova do 2º dia (mesma cor/caderno escolhida acima)
- Gabarito do 2º dia

Uma URL de gabarito já confirmada como formato válido (2026-08-16): `https://download.inep.gov.br/enem/provas_e_gabaritos/2025_GB_impresso_D2_CD7.pdf` (`D2` = dia 2, `CD7` = caderno 7). Use esse padrão como ponto de partida para localizar as outras três, mas confirme cada uma baixando de verdade (Step 2) antes de codificar — não adivinhe o nome de arquivo da prova sem verificar.

- [ ] **Step 2: Verificar cada URL baixando manualmente**

Run (repita para as 4 URLs encontradas, adaptando o nome do arquivo de saída):
```bash
curl -sL -o /tmp/teste-gabarito-d2.pdf "https://download.inep.gov.br/enem/provas_e_gabaritos/2025_GB_impresso_D2_CD7.pdf"
```
Expected: arquivo PDF válido salvo (confirme abrindo ou checando `file /tmp/teste-gabarito-d2.pdf` — deve reportar "PDF document", não HTML de erro)

- [ ] **Step 3: Criar `scripts/ingest/config.ts` com as URLs confirmadas**

Create `scripts/ingest/config.ts` (substitua os quatro valores de `PDF_URLS` pelas URLs reais confirmadas no Step 2):

```typescript
export const INGEST_YEAR = 2025;

export const PDF_URLS = {
  day1Exam: "https://download.inep.gov.br/enem/provas_e_gabaritos/2025_PV_impresso_D1_CD1.pdf",
  day1Gabarito: "https://download.inep.gov.br/enem/provas_e_gabaritos/2025_GB_impresso_D1_CD1.pdf",
  day2Exam: "https://download.inep.gov.br/enem/provas_e_gabaritos/2025_PV_impresso_D2_CD7.pdf",
  day2Gabarito: "https://download.inep.gov.br/enem/provas_e_gabaritos/2025_GB_impresso_D2_CD7.pdf",
} as const;

export const DOWNLOAD_DIR = "scripts/ingest/downloads";
```

- [ ] **Step 4: Implementar `downloadPdf`**

Create `scripts/ingest/download.ts`:

```typescript
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export async function downloadPdf(url: string, destPath: string): Promise<string> {
  if (existsSync(destPath)) {
    return destPath;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar ${url}: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(destPath), { recursive: true });
  await writeFile(destPath, buffer);
  return destPath;
}
```

- [ ] **Step 5: Adicionar a pasta de downloads ao `.gitignore`**

Modify `.gitignore` — adicione uma linha (os PDFs baixados são grandes e não devem ser commitados):

```
scripts/ingest/downloads/
```

- [ ] **Step 6: Verificar manualmente**

Run:
```bash
node -e "
const { downloadPdf } = require('./scripts/ingest/download.ts');
" 2>&1 || echo "use tsx para rodar TypeScript diretamente:"
npx tsx -e "
import { downloadPdf } from './scripts/ingest/download';
import { PDF_URLS, DOWNLOAD_DIR } from './scripts/ingest/config';
downloadPdf(PDF_URLS.day2Gabarito, DOWNLOAD_DIR + '/2025-d2-gabarito.pdf').then(p => console.log('baixado em', p));
"
```
Expected: arquivo salvo em `scripts/ingest/downloads/2025-d2-gabarito.pdf`, log confirmando o caminho

- [ ] **Step 7: Commit**

```bash
git add scripts/ingest/config.ts scripts/ingest/download.ts .gitignore
git commit -m "feat: download official INEP exam PDFs"
```

---

### Task 4: Extração de questões via Gemini

**Files:**
- Create: `lib/gemini.ts`
- Create: `scripts/ingest/types.ts`
- Create: `scripts/ingest/extract-questions.ts`

**Interfaces:**
- Consumes: `PDF_URLS`, `DOWNLOAD_DIR` de `scripts/ingest/config.ts` (Task 3)
- Produces: `ExtractedQuestion` (tipo), `extractQuestionsFromPdf(pdfPath: string, examDay: 1 | 2): Promise<ExtractedQuestion[]>`

- [ ] **Step 1: Instalar o SDK do Gemini**

```bash
npm install @google/genai
```

- [ ] **Step 2: Adicionar a variável de ambiente**

Modify `.env.example` — adicione:

```
GEMINI_API_KEY=sua-chave-do-google-ai-studio
```

Adicione o mesmo valor (com a chave real) no seu `.env.local` — já foi feito manualmente numa etapa anterior; confirme que a linha `GEMINI_API_KEY=...` está lá antes de continuar.

- [ ] **Step 3: Criar o cliente compartilhado**

Create `lib/gemini.ts`:

```typescript
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY não definida (verifique .env.local)");
}

export const gemini = new GoogleGenAI({ apiKey });
// Flash Lite (não o Flash "cheio") por causa da cota diária real desta conta:
// gemini-2.5-flash tem só 20 requisições/dia, insuficiente para iterar durante
// o desenvolvimento (qualquer re-execução ao depurar já estoura o limite).
// gemini-3.5-flash-lite tem 500/dia — folga confortável tanto para testar
// quanto para a ingestão real (que usa só ~4-6 chamadas no total).
export const GEMINI_MODEL = "gemini-3.5-flash-lite";
```

- [ ] **Step 4: Definir os tipos compartilhados**

Create `scripts/ingest/types.ts`:

```typescript
export type Alternative = { letter: string; text: string };

export type ExtractedQuestion = {
  questionNumber: number;
  statement: string;
  alternatives: Alternative[];
  hasImage: boolean;
  pageNumber: number;
  area: "linguagens" | "humanas" | "natureza" | "matematica";
  subject: string;
  topic: string;
};

export type GabaritoEntry = {
  questionNumber: number;
  correctAnswer: string;
};
```

- [ ] **Step 5: Implementar a extração**

Create `scripts/ingest/extract-questions.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { gemini, GEMINI_MODEL } from "@/lib/gemini";
import type { ExtractedQuestion } from "./types";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionNumber: { type: "integer" },
          statement: { type: "string" },
          alternatives: {
            type: "array",
            items: {
              type: "object",
              properties: {
                letter: { type: "string" },
                text: { type: "string" },
              },
              required: ["letter", "text"],
            },
          },
          hasImage: { type: "boolean" },
          pageNumber: { type: "integer" },
          area: {
            type: "string",
            enum: ["linguagens", "humanas", "natureza", "matematica"],
          },
          subject: { type: "string" },
          topic: { type: "string" },
        },
        required: [
          "questionNumber",
          "statement",
          "alternatives",
          "hasImage",
          "pageNumber",
          "area",
          "subject",
          "topic",
        ],
      },
    },
  },
  required: ["questions"],
};

const PROMPT = `Você está lendo o caderno de provas do ENEM (Exame Nacional do Ensino
Médio brasileiro). Extraia TODAS as questões objetivas de múltipla escolha deste
documento (ignore a proposta de redação, se houver).

Para cada questão, retorne: número da questão, enunciado completo, as 5
alternativas (A a E) com o texto de cada uma, se a questão tem uma figura/imagem
associada (hasImage), o número da página do PDF onde a questão aparece
(pageNumber, começando em 1), a área do conhecimento (area: linguagens, humanas,
natureza ou matematica), a disciplina específica (subject, ex: "Física",
"História", "Língua Portuguesa") e o assunto específico dentro da disciplina
(topic, ex: "Óptica — Lentes", "Revolução Industrial").

Não invente conteúdo: se não conseguir ler uma questão com confiança, ainda
assim inclua o que conseguir extrair com a maior fidelidade possível ao
enunciado original.`;

export async function extractQuestionsFromPdf(
  pdfPath: string,
  examDay: 1 | 2
): Promise<ExtractedQuestion[]> {
  const fileBuffer = await readFile(pdfPath);
  const base64Data = fileBuffer.toString("base64");

  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "application/pdf", data: base64Data } },
          { text: `${PROMPT}\n\nEste é o caderno do dia ${examDay} do ENEM.` },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini não retornou conteúdo para extração de questões");
  }

  const parsed = JSON.parse(text) as { questions: ExtractedQuestion[] };
  return parsed.questions;
}
```

Se a chamada falhar por causa de um método/propriedade diferente na versão instalada do `@google/genai` (ex: `response.text` não existe, ou a estrutura de `contents` mudou), confira `node_modules/@google/genai/dist/*.d.ts` pela assinatura correta e ajuste — a versão do pacote pode ter uma API ligeiramente diferente da documentada aqui.

- [ ] **Step 6: Verificar manualmente contra o PDF real de um dia**

Run:
```bash
npx tsx -e "
import { extractQuestionsFromPdf } from './scripts/ingest/extract-questions';
extractQuestionsFromPdf('scripts/ingest/downloads/2025-d2-exam.pdf', 2).then(qs => {
  console.log('Total extraído:', qs.length);
  console.log(JSON.stringify(qs[0], null, 2));
});
"
```
(Baixe o PDF da prova do dia 2 primeiro, usando `downloadPdf` da Task 3, se ainda não tiver feito.)

Expected: log mostrando um total próximo de 45 (uma área) ou 90 (duas áreas, se o caderno do dia inteiro foi enviado de uma vez) questões, e a primeira questão extraída com enunciado, 5 alternativas, e classificação preenchidos — leia o resultado e confirme que faz sentido (não precisa ser perfeito, mas não pode estar vazio ou visivelmente quebrado)

- [ ] **Step 7: Commit**

```bash
git add lib/gemini.ts scripts/ingest/types.ts scripts/ingest/extract-questions.ts .env.example package.json package-lock.json
git commit -m "feat: extract and classify questions from exam PDF via Gemini"
```

---

### Task 5: Extração do gabarito e junção com as questões

**Files:**
- Create: `scripts/ingest/extract-gabarito.ts`

**Interfaces:**
- Consumes: `gemini`, `GEMINI_MODEL` de `lib/gemini.ts` (Task 4), `ExtractedQuestion`, `GabaritoEntry` de `scripts/ingest/types.ts` (Task 4)
- Produces: `extractGabaritoFromPdf(pdfPath: string): Promise<GabaritoEntry[]>`, `mergeGabarito(questions: ExtractedQuestion[], gabarito: GabaritoEntry[]): (ExtractedQuestion & { correctAnswer: string })[]`

- [ ] **Step 1: Implementar a extração e a junção**

Create `scripts/ingest/extract-gabarito.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { gemini, GEMINI_MODEL } from "@/lib/gemini";
import type { ExtractedQuestion, GabaritoEntry } from "./types";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionNumber: { type: "integer" },
          correctAnswer: { type: "string" },
        },
        required: ["questionNumber", "correctAnswer"],
      },
    },
  },
  required: ["answers"],
};

const PROMPT = `Este é o gabarito oficial do ENEM. Extraia o número de cada questão e a
letra da alternativa correta (A, B, C, D ou E) correspondente.`;

export async function extractGabaritoFromPdf(
  pdfPath: string
): Promise<GabaritoEntry[]> {
  const fileBuffer = await readFile(pdfPath);
  const base64Data = fileBuffer.toString("base64");

  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "application/pdf", data: base64Data } },
          { text: PROMPT },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini não retornou conteúdo para extração do gabarito");
  }

  const parsed = JSON.parse(text) as { answers: GabaritoEntry[] };
  return parsed.answers;
}

export function mergeGabarito(
  questions: ExtractedQuestion[],
  gabarito: GabaritoEntry[]
): (ExtractedQuestion & { correctAnswer: string })[] {
  const answerByNumber = new Map(
    gabarito.map((entry) => [entry.questionNumber, entry.correctAnswer])
  );

  return questions.map((question) => {
    const correctAnswer = answerByNumber.get(question.questionNumber);
    if (!correctAnswer) {
      throw new Error(
        `Sem gabarito para a questão número ${question.questionNumber}`
      );
    }
    return { ...question, correctAnswer };
  });
}
```

- [ ] **Step 2: Escrever o teste da junção (função pura, sem chamar a API)**

Create `tests/ingest/merge-gabarito.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mergeGabarito } from "@/scripts/ingest/extract-gabarito";
import type { ExtractedQuestion } from "@/scripts/ingest/types";

const baseQuestion: ExtractedQuestion = {
  questionNumber: 91,
  statement: "...",
  alternatives: [
    { letter: "A", text: "1" },
    { letter: "B", text: "2" },
    { letter: "C", text: "3" },
    { letter: "D", text: "4" },
    { letter: "E", text: "5" },
  ],
  hasImage: false,
  pageNumber: 12,
  area: "natureza",
  subject: "Física",
  topic: "Óptica",
};

describe("mergeGabarito", () => {
  it("junta o gabarito correto pela numeração da questão", () => {
    const result = mergeGabarito(
      [baseQuestion],
      [{ questionNumber: 91, correctAnswer: "C" }]
    );
    expect(result[0].correctAnswer).toBe("C");
  });

  it("lança erro quando falta gabarito para uma questão", () => {
    expect(() => mergeGabarito([baseQuestion], [])).toThrow(
      "Sem gabarito para a questão número 91"
    );
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/ingest/merge-gabarito.test.ts`
Expected: PASS — 2 testes passando (esse teste não chama a API, só exercita `mergeGabarito`)

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest/extract-gabarito.ts tests/ingest/merge-gabarito.test.ts
git commit -m "feat: extract official gabarito and merge with extracted questions"
```

---

### Task 6: Verificação de idempotência

**Files:**
- Create: `scripts/ingest/idempotency.ts`
- Test: `tests/ingest/idempotency.test.ts`

**Interfaces:**
- Consumes: `db` de `lib/db.ts`, `questions` de `db/schema.ts` (Task 1)
- Produces: `questionAlreadyExists(year: number, examDay: number, questionNumber: number): Promise<boolean>`

- [ ] **Step 1: Escrever o teste que falha**

Create `tests/ingest/idempotency.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { questions, topics } from "@/db/schema";
import { questionAlreadyExists } from "@/scripts/ingest/idempotency";

describe("questionAlreadyExists", () => {
  it("retorna false quando a questão não existe", async () => {
    const result = await questionAlreadyExists(2098, 1, 999);
    expect(result).toBe(false);
  });

  it("retorna true quando a questão já existe (em qualquer status)", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "humanas", subject: "História", name: "Brasil Colônia" })
      .returning();

    await db.insert(questions).values({
      id: crypto.randomUUID(),
      year: 2097,
      examDay: 1,
      questionNumber: 5,
      area: "humanas",
      statement: "x",
      alternatives: [
        { letter: "A", text: "1" },
        { letter: "B", text: "2" },
        { letter: "C", text: "3" },
        { letter: "D", text: "4" },
        { letter: "E", text: "5" },
      ],
      correctAnswer: "A",
      topicId: topic.id,
      status: "rejeitada",
    });

    const result = await questionAlreadyExists(2097, 1, 5);
    expect(result).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/ingest/idempotency.test.ts`
Expected: FAIL — `Cannot find module '@/scripts/ingest/idempotency'`

- [ ] **Step 3: Implementar**

Create `scripts/ingest/idempotency.ts`:

```typescript
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { questions } from "@/db/schema";

export async function questionAlreadyExists(
  year: number,
  examDay: number,
  questionNumber: number
): Promise<boolean> {
  const [existing] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      and(
        eq(questions.year, year),
        eq(questions.examDay, examDay),
        eq(questions.questionNumber, questionNumber)
      )
    )
    .limit(1);

  return existing !== undefined;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/ingest/idempotency.test.ts`
Expected: PASS — 2 testes passando

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest/idempotency.ts tests/ingest/idempotency.test.ts
git commit -m "feat: add idempotency check for question ingestion"
```

---

### Task 7: Imagem da questão (renderização de página + upload)

**Files:**
- Create: `scripts/ingest/images.ts`

**Interfaces:**
- Consumes: nenhuma dependência de tasks anteriores além de `.env.local`
- Produces: `renderPageImage(pdfPath: string, pageNumber: number): Promise<Buffer>`, `uploadQuestionImage(buffer: Buffer, key: string): Promise<string>` (retorna a URL pública)

- [ ] **Step 1: Instalar as dependências**

```bash
npm install pdf-to-img @supabase/supabase-js
```

- [ ] **Step 2: Adicionar as variáveis de ambiente**

Modify `.env.example` — adicione:

```
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
```

Essas duas vêm do painel do Supabase: **Project Settings → API** (`SUPABASE_URL` é a "Project URL", `SUPABASE_SERVICE_ROLE_KEY` é a "service_role" secret key — não a "anon" key, essa não tem permissão de escrita administrativa no Storage). Adicione os valores reais no seu `.env.local` manualmente, do mesmo jeito que fez com `GEMINI_API_KEY`.

- [ ] **Step 3: Criar o bucket no Supabase Storage**

No painel do Supabase, vá em **Storage** → **New bucket**. Nome: `question-images`. Marque como **Public bucket** (as imagens das questões precisam ser acessíveis publicamente pelo site, sem autenticação — não há dado sensível nelas).

- [ ] **Step 4: Implementar a renderização de página e o upload**

Create `scripts/ingest/images.ts`:

```typescript
import { pdf } from "pdf-to-img";
import { createClient } from "@supabase/supabase-js";

export async function renderPageImage(
  pdfPath: string,
  pageNumber: number
): Promise<Buffer> {
  const document = await pdf(pdfPath, { scale: 2 });
  let currentPage = 0;
  for await (const page of document) {
    currentPage += 1;
    if (currentPage === pageNumber) {
      return page;
    }
  }
  throw new Error(
    `Página ${pageNumber} não encontrada em ${pdfPath} (documento tem ${currentPage} páginas)`
  );
}

function getSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não definidas (verifique .env.local)"
    );
  }
  return createClient(url, serviceRoleKey);
}

export async function uploadQuestionImage(
  buffer: Buffer,
  key: string
): Promise<string> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.storage
    .from("question-images")
    .upload(key, buffer, { contentType: "image/png", upsert: true });

  if (error) {
    throw new Error(`Falha ao subir imagem ${key}: ${error.message}`);
  }

  const { data } = supabase.storage.from("question-images").getPublicUrl(key);
  return data.publicUrl;
}
```

Se `pdf-to-img` tiver uma API diferente da usada acima (ex: retorno não é um async iterable, ou a opção `scale` tem outro nome), confira `node_modules/pdf-to-img/dist/*.d.ts` e ajuste — é um pacote menos estabelecido que os demais usados neste projeto.

- [ ] **Step 5: Verificar manualmente**

Run:
```bash
npx tsx -e "
import { renderPageImage, uploadQuestionImage } from './scripts/ingest/images';
renderPageImage('scripts/ingest/downloads/2025-d2-exam.pdf', 12)
  .then(buf => uploadQuestionImage(buf, 'teste/pagina-12.png'))
  .then(url => console.log('URL pública:', url));
"
```
Expected: log com uma URL pública do Supabase Storage; abra a URL no navegador e confirme que mostra a página 12 do PDF como imagem

- [ ] **Step 6: Commit**

```bash
git add scripts/ingest/images.ts .env.example package.json package-lock.json
git commit -m "feat: render question page images and upload to Supabase Storage"
```

---

### Task 8: Orquestrador do pipeline de ingestão

**Files:**
- Create: `scripts/ingest/topics.ts`
- Create: `scripts/ingest/run.ts`

**Interfaces:**
- Consumes: tudo das Tasks 3–7 (`downloadPdf`, `extractQuestionsFromPdf`, `extractGabaritoFromPdf`, `mergeGabarito`, `questionAlreadyExists`, `renderPageImage`, `uploadQuestionImage`, `PDF_URLS`, `INGEST_YEAR`, `DOWNLOAD_DIR`)
- Produces: `findOrCreateTopic(area, subject, name): Promise<string>` (retorna `topicId`), script executável `scripts/ingest/run.ts`

- [ ] **Step 1: Implementar `findOrCreateTopic`**

Create `scripts/ingest/topics.ts`:

```typescript
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { topics } from "@/db/schema";

export async function findOrCreateTopic(
  area: "linguagens" | "humanas" | "natureza" | "matematica",
  subject: string,
  name: string
): Promise<string> {
  const [existing] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.area, area), eq(topics.subject, subject), eq(topics.name, name)))
    .limit(1);

  if (existing) {
    return existing.id;
  }

  const [created] = await db
    .insert(topics)
    .values({ id: crypto.randomUUID(), area, subject, name })
    .returning({ id: topics.id });

  return created.id;
}
```

- [ ] **Step 2: Implementar o orquestrador**

Create `scripts/ingest/run.ts`:

```typescript
import path from "node:path";
import { db } from "@/lib/db";
import { questions } from "@/db/schema";
import { INGEST_YEAR, PDF_URLS, DOWNLOAD_DIR } from "./config";
import { downloadPdf } from "./download";
import { extractQuestionsFromPdf } from "./extract-questions";
import { extractGabaritoFromPdf, mergeGabarito } from "./extract-gabarito";
import { questionAlreadyExists } from "./idempotency";
import { renderPageImage, uploadQuestionImage } from "./images";
import { findOrCreateTopic } from "./topics";

const DELAY_BETWEEN_CALLS_MS = 4500; // ~13 chamadas/min, abaixo do limite de 15 RPM

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processDay(examDay: 1 | 2) {
  const examUrl = examDay === 1 ? PDF_URLS.day1Exam : PDF_URLS.day2Exam;
  const gabaritoUrl = examDay === 1 ? PDF_URLS.day1Gabarito : PDF_URLS.day2Gabarito;

  const examPath = await downloadPdf(
    examUrl,
    path.join(DOWNLOAD_DIR, `${INGEST_YEAR}-d${examDay}-exam.pdf`)
  );
  const gabaritoPath = await downloadPdf(
    gabaritoUrl,
    path.join(DOWNLOAD_DIR, `${INGEST_YEAR}-d${examDay}-gabarito.pdf`)
  );

  console.log(`[dia ${examDay}] extraindo questões...`);
  const extracted = await extractQuestionsFromPdf(examPath, examDay);
  await sleep(DELAY_BETWEEN_CALLS_MS);

  console.log(`[dia ${examDay}] extraindo gabarito...`);
  const gabarito = await extractGabaritoFromPdf(gabaritoPath);
  await sleep(DELAY_BETWEEN_CALLS_MS);

  const withAnswers = mergeGabarito(extracted, gabarito);

  let imported = 0;
  let skipped = 0;

  for (const question of withAnswers) {
    const alreadyExists = await questionAlreadyExists(
      INGEST_YEAR,
      examDay,
      question.questionNumber
    );
    if (alreadyExists) {
      skipped += 1;
      continue;
    }

    const topicId = await findOrCreateTopic(question.area, question.subject, question.topic);

    let imageUrl: string | null = null;
    if (question.hasImage) {
      try {
        const pageBuffer = await renderPageImage(examPath, question.pageNumber);
        imageUrl = await uploadQuestionImage(
          pageBuffer,
          `${INGEST_YEAR}/d${examDay}-q${question.questionNumber}.png`
        );
      } catch (error) {
        console.warn(
          `[dia ${examDay}] questão ${question.questionNumber}: falha ao gerar imagem — seguindo sem imagem`,
          error
        );
      }
    }

    await db.insert(questions).values({
      id: crypto.randomUUID(),
      year: INGEST_YEAR,
      examDay,
      questionNumber: question.questionNumber,
      area: question.area,
      statement: question.statement,
      alternatives: question.alternatives,
      correctAnswer: question.correctAnswer,
      imageUrl,
      topicId,
      status: "pendente",
    });
    imported += 1;
  }

  console.log(`[dia ${examDay}] concluído: ${imported} importadas, ${skipped} já existiam`);
}

async function main() {
  await processDay(1);
  await processDay(2);
  console.log("Ingestão concluída. Revise em /admin/revisao.");
}

main().catch((error) => {
  console.error("Ingestão falhou:", error);
  process.exit(1);
});
```

- [ ] **Step 3: Adicionar o script no `package.json`**

Modify `package.json`, na seção `scripts`, adicionando:

```json
"ingest": "tsx scripts/ingest/run.ts"
```

- [ ] **Step 4: Verificar manualmente (execução real, ponta a ponta)**

Run: `npm run ingest`
Expected: logs de progresso para os dois dias, terminando em "Ingestão concluída." Confirme no banco:

```bash
docker compose exec postgres psql -U postgres -d plataforma_enem -c "select status, count(*) from questions group by status;"
```
Expected: uma linha com `status = pendente` e uma contagem próxima de 180 (pode variar um pouco dependendo de quantas questões o Gemini conseguiu extrair de cada caderno)

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest/topics.ts scripts/ingest/run.ts package.json
git commit -m "feat: add ingestion pipeline orchestrator script"
```

---

### Task 9: API admin — listar questões pendentes

**Files:**
- Create: `app/api/admin/questions/route.ts`
- Test: `tests/admin-questions-api.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` de `lib/admin.ts` (Task 2), `db`, `questions`, `topics` de `db/schema.ts`
- Produces: `GET /api/admin/questions?status=pendente&area=natureza` retorna `{ questions: Array<Question & { topic: Topic }> }`

- [ ] **Step 1: Escrever o teste que falha**

Create `tests/admin-questions-api.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user, topics, questions } from "@/db/schema";
import { GET } from "@/app/api/admin/questions/route";

async function createAdminCookie() {
  const email = `admin-${crypto.randomUUID()}@example.com`;
  const signUp = await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Admin" },
  });
  await db.update(user).set({ role: "admin" }).where(eq(user.id, signUp.user.id));
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return signIn.headers.get("set-cookie") ?? "";
}

describe("GET /api/admin/questions", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/admin/questions");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("retorna as questões pendentes para um admin", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "natureza", subject: "Física", name: "Óptica" })
      .returning();

    await db.insert(questions).values({
      id: crypto.randomUUID(),
      year: 2096,
      examDay: 2,
      questionNumber: 10,
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
      status: "pendente",
    });

    const cookie = await createAdminCookie();
    const request = new Request(
      "http://localhost:3000/api/admin/questions?status=pendente",
      { headers: { cookie } }
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const found = body.questions.find((q: { year: number }) => q.year === 2096);
    expect(found).toBeDefined();
    expect(found.topic.name).toBe("Óptica");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/admin-questions-api.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/admin/questions/route'`

- [ ] **Step 3: Implementar a rota**

Create `app/api/admin/questions/route.ts`:

```typescript
import { and, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { questions, topics, type Alternative } from "@/db/schema";

export async function GET(request: Request) {
  const session = await requireAdmin(request);
  if (!session) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pendente";
  const area = url.searchParams.get("area");

  const conditions = [eq(questions.status, status as "pendente" | "aprovada" | "rejeitada")];
  if (area) {
    conditions.push(eq(questions.area, area as "linguagens" | "humanas" | "natureza" | "matematica"));
  }

  const rows = await db
    .select({
      id: questions.id,
      year: questions.year,
      examDay: questions.examDay,
      questionNumber: questions.questionNumber,
      area: questions.area,
      statement: questions.statement,
      alternatives: questions.alternatives,
      correctAnswer: questions.correctAnswer,
      imageUrl: questions.imageUrl,
      status: questions.status,
      topic: { id: topics.id, area: topics.area, subject: topics.subject, name: topics.name },
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .where(and(...conditions));

  return Response.json({ questions: rows });
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/admin-questions-api.test.ts`
Expected: PASS — 2 testes passando

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/questions/route.ts tests/admin-questions-api.test.ts
git commit -m "feat: add GET /api/admin/questions endpoint"
```

---

### Task 10: API admin — aprovar/editar/rejeitar questão

**Files:**
- Create: `app/api/admin/questions/[id]/route.ts`
- Test: `tests/admin-questions-api.test.ts` (adiciona casos ao arquivo da Task 9)

**Interfaces:**
- Consumes: `requireAdmin` de `lib/admin.ts`, `db`, `questions` de `db/schema.ts`
- Produces: `PATCH /api/admin/questions/:id` com corpo `{ status: "aprovada" | "rejeitada", statement?, alternatives?, correctAnswer?, topicId? }` — retorna a questão atualizada

- [ ] **Step 1: Adicionar os testes que falham**

Modify `tests/admin-questions-api.test.ts` — adicione um novo bloco `describe` ao final do arquivo (mantendo o `describe("GET /api/admin/questions", ...)` já existente):

```typescript
import { PATCH } from "@/app/api/admin/questions/[id]/route";

describe("PATCH /api/admin/questions/:id", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/admin/questions/x", {
      method: "PATCH",
      body: JSON.stringify({ status: "aprovada" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "x" }) });
    expect(response.status).toBe(401);
  });

  it("aprova uma questão e persiste o novo status", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ id: crypto.randomUUID(), area: "matematica", subject: "Matemática", name: "Geometria" })
      .returning();

    const [question] = await db
      .insert(questions)
      .values({
        id: crypto.randomUUID(),
        year: 2095,
        examDay: 1,
        questionNumber: 20,
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
        status: "pendente",
      })
      .returning();

    const cookie = await createAdminCookie();
    const request = new Request(
      `http://localhost:3000/api/admin/questions/${question.id}`,
      {
        method: "PATCH",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "aprovada" }),
      }
    );
    const response = await PATCH(request, { params: Promise.resolve({ id: question.id }) });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("aprovada");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/admin-questions-api.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/admin/questions/[id]/route'`

- [ ] **Step 3: Implementar a rota**

Create `app/api/admin/questions/[id]/route.ts`:

```typescript
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { questions } from "@/db/schema";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin(request);
  if (!session) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const allowedFields = ["status", "statement", "alternatives", "correctAnswer", "topicId"] as const;
  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
  }

  const [updated] = await db
    .update(questions)
    .set(updates)
    .where(eq(questions.id, id))
    .returning();

  if (!updated) {
    return Response.json({ error: "Questão não encontrada" }, { status: 404 });
  }

  return Response.json(updated);
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/admin-questions-api.test.ts`
Expected: PASS — 4 testes passando (2 da Task 9 + 2 novos)

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/questions/[id]/route.ts tests/admin-questions-api.test.ts
git commit -m "feat: add PATCH /api/admin/questions/:id endpoint"
```

---

### Task 11: Tela de revisão admin

**Files:**
- Create: `app/admin/revisao/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/questions` (Task 9), `PATCH /api/admin/questions/:id` (Task 10)
- Produces: página em `/admin/revisao`

- [ ] **Step 1: Proteger a rota no middleware**

Modify `middleware.ts` — no bloco de exclusões de rotas públicas (`if (pathname === "/api/health" || ...)`), a rota `/admin/revisao` **não** deve ser adicionada às exclusões (ela já cai sob o matcher `"/api/:path*"` só para chamadas de API; para a página em si, a proteção acontece dentro do componente, no Step 2, já que middleware hoje só cobre `/api/*`). Nenhuma mudança de código neste arquivo é necessária — só confirme lendo o arquivo atual que o matcher é `["/api/:path*"]` e que isso não impede a página `/admin/revisao` de carregar (ela vai se autoproteger client-side redirecionando se a API retornar 401).

- [ ] **Step 2: Implementar a página**

Create `app/admin/revisao/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

type Alternative = { letter: string; text: string };

type Question = {
  id: string;
  year: number;
  examDay: number;
  questionNumber: number;
  area: string;
  statement: string;
  alternatives: Alternative[];
  correctAnswer: string;
  imageUrl: string | null;
  status: string;
  topic: { id: string; area: string; subject: string; name: string };
};

export default function RevisaoPage() {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/questions?status=pendente")
      .then((response) => {
        if (response.status === 401) {
          throw new Error("Não autorizado — faça login com uma conta admin.");
        }
        return response.json();
      })
      .then((data) => setQuestions(data.questions))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function handleAction(id: string, status: "aprovada" | "rejeitada") {
    const response = await fetch(`/api/admin/questions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (response.ok) {
      setQuestions((prev) => (prev ? prev.filter((q) => q.id !== id) : prev));
    }
  }

  if (error) {
    return <p>{error}</p>;
  }

  if (!questions) {
    return <p>Carregando...</p>;
  }

  if (questions.length === 0) {
    return <p>Nenhuma questão pendente de revisão.</p>;
  }

  return (
    <main>
      <h1>Revisão de questões ({questions.length} pendentes)</h1>
      {questions.map((question) => (
        <article key={question.id} style={{ border: "1px solid #ccc", padding: 16, marginBottom: 16 }}>
          <p>
            <strong>
              {question.year} — Dia {question.examDay} — Questão {question.questionNumber}
            </strong>{" "}
            ({question.topic.subject} — {question.topic.name})
          </p>
          <p>{question.statement}</p>
          {question.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={question.imageUrl} alt="Figura da questão" style={{ maxWidth: 400 }} />
          )}
          <ul>
            {question.alternatives.map((alt) => (
              <li key={alt.letter}>
                {alt.letter}) {alt.text}
                {alt.letter === question.correctAnswer && " ✓"}
              </li>
            ))}
          </ul>
          <button onClick={() => handleAction(question.id, "aprovada")}>Aprovar</button>{" "}
          <button onClick={() => handleAction(question.id, "rejeitada")}>Rejeitar</button>
        </article>
      ))}
    </main>
  );
}
```

- [ ] **Step 3: Verificar manualmente**

Run: `npm run dev` (em um terminal separado)

Abra `http://localhost:3000/admin/revisao` no navegador sem estar logado.
Expected: mensagem "Não autorizado — faça login com uma conta admin."

Faça login com uma conta cujo `role` foi manualmente definido como `admin` no banco (`update "user" set role = 'admin' where email = 'seu-email@...'`), e recarregue a página.
Expected: lista de questões pendentes (se já rodou a ingestão) ou "Nenhuma questão pendente de revisão."

Pare o servidor de desenvolvimento depois de confirmar.

- [ ] **Step 4: Commit**

```bash
git add app/admin/revisao/page.tsx
git commit -m "feat: add admin question review screen"
```

---

### Task 12: Documentação

**Files:**
- Modify: `README.md`

**Interfaces:**
- Nenhuma — só documentação

- [ ] **Step 1: Adicionar a seção de curadoria de questões**

Modify `README.md` — adicione ao final do arquivo:

```markdown
## Curadoria de questões (banco de questões do ENEM)

Pipeline de ingestão local (não roda no site em produção — só no seu computador):

1. Configure as variáveis no `.env.local`: `GEMINI_API_KEY` (aistudio.google.com),
   `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (painel do Supabase → Project
   Settings → API)
2. Confirme que o bucket `question-images` existe no Supabase Storage (público)
3. Rode `npm run ingest` — baixa as provas de 2025, extrai e classifica as
   questões via Gemini, e grava tudo com status `pendente` (leva uns 15-20
   minutos)
4. Acesse `/admin/revisao` logado com uma conta `admin` (marque
   `role = 'admin'` na tabela `user` do banco) para aprovar, corrigir ou
   rejeitar cada questão extraída
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the question ingestion pipeline"
```

---

## Self-Review Notes

- **Cobertura do spec:** cobre todas as seções do spec — modelo de dados (Task 1), pipeline de ingestão completo (Tasks 3–8), tela de revisão (Tasks 9–11), segurança (`requireAdmin` na Task 2, aplicado em todas as rotas admin), testes (cada task com lógica testável tem teste real contra Postgres; a extração via Gemini em si é verificada manualmente, conforme o spec definiu explicitamente como fora do escopo de CI).
- **Desvio deliberado do spec, documentado:** o spec descrevia "uma chamada ao Gemini por questão". Na prática, mandar o caderno do dia inteiro numa única chamada (Tasks 4 e 5) é mais eficiente, mais preciso (o modelo vê o documento completo, não uma página isolada fora de contexto) e usa uma fração do limite de taxa — a meta do spec (extrair e classificar cada questão, respeitando o limite da API) continua atendida, só o mecanismo interno mudou. Registrado aqui para transparência.
- **Consistência de tipos:** `ExtractedQuestion` (Task 4) é consumido por `mergeGabarito` (Task 5) e por `run.ts` (Task 8) com o mesmo formato em todas as tasks. `requireAdmin` (Task 2) retorna `{ user: { id, email, role } }`, usado da mesma forma nas Tasks 9 e 10. `topicId`/`topic` nomeados de forma consistente entre schema (Task 1), API (Task 9) e UI (Task 11).
- **Placeholders:** nenhum "TBD"/"TODO". As únicas incertezas genuínas (URLs exatas dos PDFs do INEP, forma exata da API do `@google/genai`/`pdf-to-img` instalada) são tratadas como passos de verificação explícitos dentro das tasks, não como lacunas deixadas em aberto.
