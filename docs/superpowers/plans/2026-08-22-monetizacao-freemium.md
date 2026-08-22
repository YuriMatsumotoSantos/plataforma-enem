# Monetização freemium — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir um plano pago único "Premium" (R$ 29,90/mês) via Stripe, com limites de uso no plano grátis em Prática por assunto, Simulados e Redação com correção por IA.

**Architecture:** Uma tabela `subscriptions` (sincronizada por webhook da Stripe) é a fonte da verdade sobre o plano do usuário. Um módulo central, `lib/entitlements.ts`, expõe `getUserPlan` + três funções `can...` que checam contagens sobre tabelas já existentes (`attempts`, `simulados`, `redacoes`). Três rotas de API já existentes ganham uma checagem de entitlement no início; três rotas novas (`checkout`, `portal`, `webhook`) fazem a integração com a Stripe.

**Tech Stack:** Next.js 15 App Router (route handlers), Drizzle ORM + Postgres, biblioteca `stripe` (Node SDK oficial), Vitest com Postgres local real (sem mocks de banco).

## Global Constraints

- UI inteiramente em português (nenhum texto em inglês visível ao usuário).
- Rotas de API seguem o padrão já estabelecido: `requireUser(request)` de `@/lib/session` retorna `{user:{id,email}} | null`; sessão ausente → `401 {error: "Não autenticado"}`.
- Zero mocks contra o Postgres — todo teste de lógica de banco roda contra o Postgres local real (Docker Compose, porta 5433). Mocka-se apenas clientes de serviços externos de terceiros (aqui, `lib/stripe.ts`) quando um teste precisaria de rede real.
- Chaves de serviços externos (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PREMIUM`) **não** entram no `envSchema` de `lib/env.ts` — são lidas direto de `process.env`, mesma convenção de `GEMINI_API_KEY`/`ANTHROPIC_API_KEY`.
- `npm run lint && npx next build && npx tsc --noEmit`, nessa ordem exata, antes de considerar qualquer task terminada (build precisa rodar antes do typecheck neste projeto — gera `.next/types` que `app/layout.tsx` usa).
- Todo texto de erro voltado ao usuário é uma frase em português clara, sem detalhe técnico vazado.
- Spec completa: `docs/superpowers/specs/2026-08-22-monetizacao-freemium-design.md`.

---

### Task 1: Instalar a Stripe e criar o cliente preguiçoso

**Files:**
- Modify: `package.json` (via `npm install`)
- Create: `lib/stripe.ts`

**Interfaces:**
- Produces: `getStripeClient(): Stripe` — importado por todas as tasks seguintes que falam com a Stripe.

- [ ] **Step 1: Instalar a dependência**

Run: `npm install stripe`

Isso adiciona `stripe` a `dependencies` em `package.json` com a versão mais recente publicada — não fixe uma versão manualmente, deixe o npm resolver.

- [ ] **Step 2: Criar `lib/stripe.ts`**

```ts
import Stripe from "stripe";

let client: Stripe | undefined;

// Inicialização preguiçosa, mesmo padrão de lib/gemini.ts e lib/anthropic.ts:
// construir o cliente (e validar a chave) só na primeira chamada real, não no
// carregamento do módulo — evita que importar este arquivo quebre em
// ambientes sem STRIPE_SECRET_KEY, como o CI.
export function getStripeClient(): Stripe {
  if (!client) {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error("STRIPE_SECRET_KEY não definida (verifique .env.local)");
    }
    client = new Stripe(apiKey);
  }
  return client;
}
```

- [ ] **Step 3: Confirmar que o projeto ainda builda com a dependência nova**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a `lib/stripe.ts` ou ao pacote `stripe`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json lib/stripe.ts
git commit -m "feat: adiciona SDK da Stripe e cliente preguiçoso"
```

---

### Task 2: Tabela `subscriptions`

**Files:**
- Modify: `db/schema.ts`
- Create: migração via `npm run db:generate` (arquivo gerado em `drizzle/`)
- Test: `tests/schema-subscriptions.test.ts`

**Interfaces:**
- Consumes: `user` table de `db/schema.ts` (já existe).
- Produces: `subscriptions` table, `subscriptionStatus` enum, `type Subscription = typeof subscriptions.$inferSelect` — usados por `lib/entitlements.ts` (Task 3) e pelas rotas de Stripe (Tasks 4-6).

- [ ] **Step 1: Adicionar ao final de `db/schema.ts`**

```ts
export const subscriptionStatus = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
]);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    status: subscriptionStatus("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("subscriptions_userId_idx").on(table.userId)]
);

export type Subscription = typeof subscriptions.$inferSelect;
```

- [ ] **Step 2: Gerar e aplicar a migração**

Run: `npm run db:generate`
Expected: um novo arquivo `drizzle/0006_*.sql` criando a tabela `subscriptions` e o enum `subscription_status`.

Run: `npm run db:migrate`
Expected: sem erros; a migração é aplicada ao Postgres local (porta 5433 — confirme antes que `docker compose up -d` está rodando).

- [ ] **Step 3: Escrever o teste (falhando antes de existir, mas a tabela já foi criada no Step 2 — este teste valida o schema, não TDD de código de aplicação)**

Create `tests/schema-subscriptions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user, subscriptions } from "@/db/schema";

async function createTestUser() {
  const [row] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Aluno Teste",
      email: `subscriptions-schema-${crypto.randomUUID()}@example.com`,
      emailVerified: false,
    })
    .returning();
  return row;
}

describe("schema: subscriptions", () => {
  it("insere uma assinatura e lê de volta", async () => {
    const testUser = await createTestUser();
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [sub] = await db
      .insert(subscriptions)
      .values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        stripeCustomerId: `cus_${crypto.randomUUID()}`,
        stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
        status: "active",
        currentPeriodEnd: periodEnd,
      })
      .returning();

    const [found] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
    expect(found.status).toBe("active");
    expect(found.currentPeriodEnd.getTime()).toBe(periodEnd.getTime());
  });

  it("rejeita uma segunda assinatura para o mesmo usuário (userId é unique)", async () => {
    const testUser = await createTestUser();
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId: testUser.id,
      stripeCustomerId: `cus_${crypto.randomUUID()}`,
      stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
      status: "active",
      currentPeriodEnd: new Date(),
    });

    await expect(
      db.insert(subscriptions).values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        stripeCustomerId: `cus_${crypto.randomUUID()}`,
        stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
        status: "active",
        currentPeriodEnd: new Date(),
      })
    ).rejects.toThrow();
  });

  it("apaga a assinatura em cascata quando o usuário é apagado", async () => {
    const testUser = await createTestUser();
    const [sub] = await db
      .insert(subscriptions)
      .values({
        id: crypto.randomUUID(),
        userId: testUser.id,
        stripeCustomerId: `cus_${crypto.randomUUID()}`,
        stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
        status: "active",
        currentPeriodEnd: new Date(),
      })
      .returning();

    await db.delete(user).where(eq(user.id, testUser.id));

    const remaining = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
    expect(remaining).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test -- schema-subscriptions`
Expected: 3 testes passando.

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts drizzle/ tests/schema-subscriptions.test.ts
git commit -m "feat: adiciona tabela subscriptions"
```

---

### Task 3: `lib/entitlements.ts`

**Files:**
- Create: `lib/entitlements.ts`
- Test: `tests/entitlements.test.ts`

**Interfaces:**
- Consumes: `subscriptions`, `attempts`, `simulados`, `redacoes` de `@/db/schema` (Task 2 e tabelas já existentes); `db` de `@/lib/db`.
- Produces: `type Plan = "free" | "premium"`, `getUserPlan(userId: string): Promise<Plan>`, `canPracticeToday(userId: string): Promise<boolean>`, `canStartSimulado(userId: string): Promise<boolean>`, `canSubmitRedacao(userId: string): Promise<boolean>` — consumidos pelas Tasks 7, 8, 9 (gates) e pela Task 10 (`/api/me`).

- [ ] **Step 1: Escrever os testes primeiro**

Create `tests/entitlements.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { user, subscriptions, attempts, simulados, redacoes, temas } from "@/db/schema";
import {
  getUserPlan,
  canPracticeToday,
  canStartSimulado,
  canSubmitRedacao,
} from "@/lib/entitlements";

async function createTestUser() {
  const [row] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Aluno Teste",
      email: `entitlements-${crypto.randomUUID()}@example.com`,
      emailVerified: false,
    })
    .returning();
  return row;
}

async function makePremium(userId: string, periodEndOffsetMs: number) {
  await db.insert(subscriptions).values({
    id: crypto.randomUUID(),
    userId,
    stripeCustomerId: `cus_${crypto.randomUUID()}`,
    stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
    status: "active",
    currentPeriodEnd: new Date(Date.now() + periodEndOffsetMs),
  });
}

describe("getUserPlan", () => {
  it("retorna free quando não há linha em subscriptions", async () => {
    const testUser = await createTestUser();
    expect(await getUserPlan(testUser.id)).toBe("free");
  });

  it("retorna premium quando status é active e currentPeriodEnd está no futuro", async () => {
    const testUser = await createTestUser();
    await makePremium(testUser.id, 30 * 24 * 60 * 60 * 1000);
    expect(await getUserPlan(testUser.id)).toBe("premium");
  });

  it("retorna free quando currentPeriodEnd já passou, mesmo com status active", async () => {
    const testUser = await createTestUser();
    await makePremium(testUser.id, -1000);
    expect(await getUserPlan(testUser.id)).toBe("free");
  });

  it("retorna free quando status é canceled", async () => {
    const testUser = await createTestUser();
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId: testUser.id,
      stripeCustomerId: `cus_${crypto.randomUUID()}`,
      stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
      status: "canceled",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    expect(await getUserPlan(testUser.id)).toBe("free");
  });
});

describe("canPracticeToday", () => {
  it("permite quando o usuário ainda não respondeu nada hoje", async () => {
    const testUser = await createTestUser();
    expect(await canPracticeToday(testUser.id)).toBe(true);
  });

  it("bloqueia ao atingir 20 tentativas hoje no plano grátis", async () => {
    const testUser = await createTestUser();
    for (let i = 0; i < 20; i++) {
      await db.insert(attempts).values({
        id: crypto.randomUUID(),
        questionId: crypto.randomUUID(),
        userId: testUser.id,
        selectedAnswer: "A",
        isCorrect: true,
      });
    }
    expect(await canPracticeToday(testUser.id)).toBe(false);
  });

  it("não bloqueia usuário premium mesmo acima de 20 tentativas hoje", async () => {
    const testUser = await createTestUser();
    await makePremium(testUser.id, 30 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < 25; i++) {
      await db.insert(attempts).values({
        id: crypto.randomUUID(),
        questionId: crypto.randomUUID(),
        userId: testUser.id,
        selectedAnswer: "A",
        isCorrect: true,
      });
    }
    expect(await canPracticeToday(testUser.id)).toBe(true);
  });

  it("não conta tentativas de outro usuário", async () => {
    const testUser = await createTestUser();
    const otherUser = await createTestUser();
    for (let i = 0; i < 20; i++) {
      await db.insert(attempts).values({
        id: crypto.randomUUID(),
        questionId: crypto.randomUUID(),
        userId: otherUser.id,
        selectedAnswer: "A",
        isCorrect: true,
      });
    }
    expect(await canPracticeToday(testUser.id)).toBe(true);
  });
});

describe("canStartSimulado", () => {
  it("permite o primeiro simulado no plano grátis", async () => {
    const testUser = await createTestUser();
    expect(await canStartSimulado(testUser.id)).toBe(true);
  });

  it("bloqueia o segundo simulado no plano grátis", async () => {
    const testUser = await createTestUser();
    await db.insert(simulados).values({
      id: crypto.randomUUID(),
      userId: testUser.id,
      mode: "mesclado",
      examDay: 1,
      questionIds: [],
      durationSeconds: 100,
    });
    expect(await canStartSimulado(testUser.id)).toBe(false);
  });

  it("não bloqueia usuário premium no segundo simulado", async () => {
    const testUser = await createTestUser();
    await makePremium(testUser.id, 30 * 24 * 60 * 60 * 1000);
    await db.insert(simulados).values({
      id: crypto.randomUUID(),
      userId: testUser.id,
      mode: "mesclado",
      examDay: 1,
      questionIds: [],
      durationSeconds: 100,
    });
    expect(await canStartSimulado(testUser.id)).toBe(true);
  });
});

describe("canSubmitRedacao", () => {
  async function createTema() {
    const [tema] = await db
      .insert(temas)
      .values({ id: crypto.randomUUID(), title: `Tema entitlements ${crypto.randomUUID()}` })
      .returning();
    return tema;
  }

  async function insertRedacao(userId: string, temaId: string, createdAt: Date) {
    await db.insert(redacoes).values({
      id: crypto.randomUUID(),
      userId,
      temaId,
      text: "Texto de teste.",
      scores: { competencia1: 0, competencia2: 0, competencia3: 0, competencia4: 0, competencia5: 0 },
      notaTotal: 0,
      feedback: { justificativas: ["", "", "", "", ""], comentarioGeral: "" },
      createdAt,
    });
  }

  it("permite a primeira correção do mês no plano grátis", async () => {
    const testUser = await createTestUser();
    expect(await canSubmitRedacao(testUser.id)).toBe(true);
  });

  it("bloqueia a segunda correção do mês no plano grátis", async () => {
    const testUser = await createTestUser();
    const tema = await createTema();
    await insertRedacao(testUser.id, tema.id, new Date());
    expect(await canSubmitRedacao(testUser.id)).toBe(false);
  });

  it("uma redação do mês passado não conta para o limite do mês atual", async () => {
    const testUser = await createTestUser();
    const tema = await createTema();
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    await insertRedacao(testUser.id, tema.id, lastMonth);
    expect(await canSubmitRedacao(testUser.id)).toBe(true);
  });

  it("premium permite até 20 correções no mês", async () => {
    const testUser = await createTestUser();
    await makePremium(testUser.id, 30 * 24 * 60 * 60 * 1000);
    const tema = await createTema();
    for (let i = 0; i < 20; i++) {
      await insertRedacao(testUser.id, tema.id, new Date());
    }
    expect(await canSubmitRedacao(testUser.id)).toBe(false);
    expect(await canSubmitRedacao(testUser.id)).not.toBeUndefined();
  });

  it("premium com 19 correções no mês ainda pode enviar mais uma", async () => {
    const testUser = await createTestUser();
    await makePremium(testUser.id, 30 * 24 * 60 * 60 * 1000);
    const tema = await createTema();
    for (let i = 0; i < 19; i++) {
      await insertRedacao(testUser.id, tema.id, new Date());
    }
    expect(await canSubmitRedacao(testUser.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham (módulo não existe ainda)**

Run: `npm test -- entitlements`
Expected: FAIL com `Cannot find module '@/lib/entitlements'`.

- [ ] **Step 3: Implementar `lib/entitlements.ts`**

```ts
import { and, eq, gte, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, attempts, simulados, redacoes } from "@/db/schema";

export type Plan = "free" | "premium";

const DAILY_PRACTICE_LIMIT = 20;
const FREE_SIMULADO_LIMIT = 1;
const FREE_REDACAO_MONTHLY_LIMIT = 1;
const PREMIUM_REDACAO_MONTHLY_LIMIT = 20;

function startOfDay(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getUserPlan(userId: string): Promise<Plan> {
  const [row] = await db
    .select({ status: subscriptions.status, currentPeriodEnd: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));

  if (!row) return "free";

  const isActiveStatus = row.status === "active" || row.status === "trialing";
  const isWithinPeriod = row.currentPeriodEnd.getTime() > Date.now();
  return isActiveStatus && isWithinPeriod ? "premium" : "free";
}

export async function canPracticeToday(userId: string): Promise<boolean> {
  if ((await getUserPlan(userId)) === "premium") return true;

  const [{ value }] = await db
    .select({ value: count() })
    .from(attempts)
    .where(and(eq(attempts.userId, userId), gte(attempts.createdAt, startOfDay())));

  return value < DAILY_PRACTICE_LIMIT;
}

export async function canStartSimulado(userId: string): Promise<boolean> {
  if ((await getUserPlan(userId)) === "premium") return true;

  const [{ value }] = await db
    .select({ value: count() })
    .from(simulados)
    .where(eq(simulados.userId, userId));

  return value < FREE_SIMULADO_LIMIT;
}

export async function canSubmitRedacao(userId: string): Promise<boolean> {
  const plan = await getUserPlan(userId);
  const limit = plan === "premium" ? PREMIUM_REDACAO_MONTHLY_LIMIT : FREE_REDACAO_MONTHLY_LIMIT;

  const [{ value }] = await db
    .select({ value: count() })
    .from(redacoes)
    .where(and(eq(redacoes.userId, userId), gte(redacoes.createdAt, startOfMonth())));

  return value < limit;
}
```

- [ ] **Step 4: Rodar os testes de novo**

Run: `npm test -- entitlements`
Expected: todos os testes passando (16 no total).

- [ ] **Step 5: Rodar a suíte completa (confirmar que nada mais quebrou)**

Run: `npm test`
Expected: todos os testes passando.

- [ ] **Step 6: Commit**

```bash
git add lib/entitlements.ts tests/entitlements.test.ts
git commit -m "feat: adiciona lib/entitlements com getUserPlan e gates de uso"
```

---

### Task 4: `.env.example` + `POST /api/stripe/checkout`

**Files:**
- Modify: `.env.example`
- Create: `app/api/stripe/checkout/route.ts`
- Test: `tests/stripe-checkout-api.test.ts`

**Interfaces:**
- Consumes: `requireUser` de `@/lib/session`; `getStripeClient` de `@/lib/stripe` (Task 1); `subscriptions` de `@/db/schema` (Task 2).
- Produces: `POST /api/stripe/checkout` → `200 {url: string}` | `401` | `500` | `502`. Consumido pela página `/planos` (Task 10).

- [ ] **Step 1: Adicionar as 3 variáveis novas a `.env.example`**

Adicione ao final do arquivo:

```
STRIPE_SECRET_KEY=sk_test_sua-chave-secreta-da-stripe
STRIPE_WEBHOOK_SECRET=whsec_seu-segredo-de-webhook-da-stripe
STRIPE_PRICE_ID_PREMIUM=price_id-do-plano-premium-no-dashboard-da-stripe
```

- [ ] **Step 2: Escrever o teste primeiro**

Create `tests/stripe-checkout-api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/stripe", () => ({
  getStripeClient: vi.fn(),
}));

import { getStripeClient } from "@/lib/stripe";
import { POST } from "@/app/api/stripe/checkout/route";

async function createUserCookie() {
  const email = `checkout-${crypto.randomUUID()}@example.com`;
  await auth.api.signUpEmail({ body: { email, password: "senha-segura-123", name: "Aluno" } });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return signIn.headers.get("set-cookie") ?? "";
}

beforeEach(() => {
  process.env.STRIPE_PRICE_ID_PREMIUM = "price_test_123";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
});

describe("POST /api/stripe/checkout", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/stripe/checkout", { method: "POST" });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("cria uma sessão de checkout e retorna a url", async () => {
    const cookie = await createUserCookie();
    vi.mocked(getStripeClient).mockReturnValue({
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({ url: "https://checkout.stripe.com/test-session" }),
        },
      },
    } as never);

    const request = new Request("http://localhost:3000/api/stripe/checkout", {
      method: "POST",
      headers: { cookie },
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://checkout.stripe.com/test-session");
  });

  it("retorna 502 quando a Stripe não devolve uma url", async () => {
    const cookie = await createUserCookie();
    vi.mocked(getStripeClient).mockReturnValue({
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({ url: null }),
        },
      },
    } as never);

    const request = new Request("http://localhost:3000/api/stripe/checkout", {
      method: "POST",
      headers: { cookie },
    });
    const response = await POST(request);
    expect(response.status).toBe(502);
  });
});
```

- [ ] **Step 3: Rodar para confirmar que falha**

Run: `npm test -- stripe-checkout-api`
Expected: FAIL (rota não existe).

- [ ] **Step 4: Implementar a rota**

Create `app/api/stripe/checkout/route.ts`:

```ts
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getStripeClient } from "@/lib/stripe";
import { db } from "@/lib/db";
import { subscriptions } from "@/db/schema";

export async function POST(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const priceId = process.env.STRIPE_PRICE_ID_PREMIUM;
  if (!priceId) {
    return Response.json({ error: "Checkout indisponível no momento" }, { status: 500 });
  }

  const [existing] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, session.user.id));

  const stripe = getStripeClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/planos?sucesso=1`,
    cancel_url: `${appUrl}/planos`,
    customer: existing?.stripeCustomerId,
    customer_email: existing ? undefined : session.user.email,
    subscription_data: { metadata: { userId: session.user.id } },
  });

  if (!checkoutSession.url) {
    return Response.json({ error: "Não foi possível iniciar o checkout" }, { status: 502 });
  }

  return Response.json({ url: checkoutSession.url });
}
```

`subscription_data.metadata.userId` é o que permite ao webhook (Task 6) associar a
assinatura criada na Stripe a um usuário deste banco, sem precisar de uma segunda
chamada de rede para buscar a sessão de checkout.

- [ ] **Step 5: Rodar os testes de novo**

Run: `npm test -- stripe-checkout-api`
Expected: 3 testes passando.

- [ ] **Step 6: Rodar lint, build e typecheck, nessa ordem**

Run: `npm run lint && npx next build && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add .env.example app/api/stripe/checkout/route.ts tests/stripe-checkout-api.test.ts
git commit -m "feat: adiciona POST /api/stripe/checkout"
```

---

### Task 5: `POST /api/stripe/portal`

**Files:**
- Create: `app/api/stripe/portal/route.ts`
- Test: `tests/stripe-portal-api.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `getStripeClient`, `subscriptions` (mesmos das Tasks 1, 2, 4).
- Produces: `POST /api/stripe/portal` → `200 {url: string}` | `401` | `400`. Consumido pela página `/planos` (Task 10).

- [ ] **Step 1: Escrever o teste primeiro**

Create `tests/stripe-portal-api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { subscriptions } from "@/db/schema";

vi.mock("@/lib/stripe", () => ({
  getStripeClient: vi.fn(),
}));

import { getStripeClient } from "@/lib/stripe";
import { POST } from "@/app/api/stripe/portal/route";

async function createUserAndCookie() {
  const email = `portal-${crypto.randomUUID()}@example.com`;
  const signUp = await auth.api.signUpEmail({
    body: { email, password: "senha-segura-123", name: "Aluno" },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password: "senha-segura-123" },
    asResponse: true,
  });
  return { userId: signUp.user.id, cookie: signIn.headers.get("set-cookie") ?? "" };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
});

describe("POST /api/stripe/portal", () => {
  it("retorna 401 sem sessão", async () => {
    const request = new Request("http://localhost:3000/api/stripe/portal", { method: "POST" });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("retorna 400 quando o usuário nunca assinou", async () => {
    const { cookie } = await createUserAndCookie();
    const request = new Request("http://localhost:3000/api/stripe/portal", {
      method: "POST",
      headers: { cookie },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("cria uma sessão de portal e retorna a url quando já existe assinatura", async () => {
    const { userId, cookie } = await createUserAndCookie();
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId,
      stripeCustomerId: "cus_teste_portal",
      stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    vi.mocked(getStripeClient).mockReturnValue({
      billingPortal: {
        sessions: {
          create: vi.fn().mockResolvedValue({ url: "https://billing.stripe.com/test-portal" }),
        },
      },
    } as never);

    const request = new Request("http://localhost:3000/api/stripe/portal", {
      method: "POST",
      headers: { cookie },
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://billing.stripe.com/test-portal");
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `npm test -- stripe-portal-api`
Expected: FAIL (rota não existe).

- [ ] **Step 3: Implementar a rota**

Create `app/api/stripe/portal/route.ts`:

```ts
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getStripeClient } from "@/lib/stripe";
import { db } from "@/lib/db";
import { subscriptions } from "@/db/schema";

export async function POST(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const [existing] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, session.user.id));

  if (!existing) {
    return Response.json({ error: "Você ainda não tem uma assinatura" }, { status: 400 });
  }

  const stripe = getStripeClient();
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: existing.stripeCustomerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/planos`,
  });

  return Response.json({ url: portalSession.url });
}
```

- [ ] **Step 4: Rodar os testes de novo**

Run: `npm test -- stripe-portal-api`
Expected: 3 testes passando.

- [ ] **Step 5: Commit**

```bash
git add app/api/stripe/portal/route.ts tests/stripe-portal-api.test.ts
git commit -m "feat: adiciona POST /api/stripe/portal"
```

---

### Task 6: `POST /api/stripe/webhook`

**Files:**
- Create: `app/api/stripe/webhook/route.ts`
- Test: `tests/stripe-webhook-api.test.ts`

**Interfaces:**
- Consumes: `getStripeClient` (Task 1), `subscriptions` (Task 2).
- Produces: `POST /api/stripe/webhook` → `200 {received: true}` | `400` | `500`. Esta rota é quem mantém `subscriptions` sincronizada; não é chamada por nenhuma página, só pela própria Stripe.

- [ ] **Step 1: Verificar o campo real de período de cobrança no SDK instalado**

A API da Stripe já mudou, entre versões, onde o fim do período de cobrança fica
exposto no objeto `Subscription` (às vezes direto em `subscription.current_period_end`,
às vezes só em `subscription.items.data[0].current_period_end`). Antes de escrever
o código abaixo, abra `node_modules/stripe/types/Subscriptions.d.ts` (ou o arquivo de
tipos equivalente instalado pela Task 1) e confirme qual dos dois campos existe na
versão do SDK que foi instalada. O código abaixo assume
`sub.items.data[0].current_period_end` (padrão mais recente); se a versão instalada
expuser `sub.current_period_end` diretamente, ajuste `upsertSubscription` para usar
esse campo em vez disso — o restante do arquivo não muda.

- [ ] **Step 2: Escrever o teste primeiro**

Create `tests/stripe-webhook-api.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { user, subscriptions } from "@/db/schema";
import { POST } from "@/app/api/stripe/webhook/route";

const WEBHOOK_SECRET = "whsec_teste_fixo_de_ambiente_local";

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "sk_test_dummy_para_testes";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

async function createTestUser() {
  const [row] = await db
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Aluno Teste",
      email: `webhook-${crypto.randomUUID()}@example.com`,
      emailVerified: false,
    })
    .returning();
  return row;
}

function buildSubscriptionEvent(
  type: string,
  overrides: {
    id: string;
    status: string;
    customer: string;
    metadata?: Record<string, string>;
  }
) {
  return {
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    type,
    data: {
      object: {
        id: overrides.id,
        object: "subscription",
        status: overrides.status,
        customer: overrides.customer,
        metadata: overrides.metadata ?? {},
        items: {
          data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 }],
        },
      },
    },
  };
}

function sign(payload: string) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
}

function postWebhook(payload: string, signature: string) {
  return POST(
    new Request("http://localhost:3000/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    })
  );
}

describe("POST /api/stripe/webhook", () => {
  it("retorna 400 com assinatura inválida", async () => {
    const payload = JSON.stringify({ type: "customer.subscription.created" });
    const response = await postWebhook(payload, "assinatura-forjada");
    expect(response.status).toBe(400);
  });

  it("insere a assinatura em customer.subscription.created usando metadata.userId", async () => {
    const testUser = await createTestUser();
    const subscriptionId = `sub_${crypto.randomUUID()}`;
    const payload = JSON.stringify(
      buildSubscriptionEvent("customer.subscription.created", {
        id: subscriptionId,
        status: "active",
        customer: "cus_teste_webhook",
        metadata: { userId: testUser.id },
      })
    );
    const response = await postWebhook(payload, sign(payload));
    expect(response.status).toBe(200);

    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
    expect(row.userId).toBe(testUser.id);
    expect(row.status).toBe("active");
  });

  it("atualiza a assinatura existente em customer.subscription.updated sem duplicar", async () => {
    const testUser = await createTestUser();
    const subscriptionId = `sub_${crypto.randomUUID()}`;
    const createdPayload = JSON.stringify(
      buildSubscriptionEvent("customer.subscription.created", {
        id: subscriptionId,
        status: "active",
        customer: "cus_teste_webhook",
        metadata: { userId: testUser.id },
      })
    );
    await postWebhook(createdPayload, sign(createdPayload));

    const updatedPayload = JSON.stringify(
      buildSubscriptionEvent("customer.subscription.updated", {
        id: subscriptionId,
        status: "past_due",
        customer: "cus_teste_webhook",
      })
    );
    const response = await postWebhook(updatedPayload, sign(updatedPayload));
    expect(response.status).toBe(200);

    const rows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("past_due");
  });

  it("marca como canceled em customer.subscription.deleted", async () => {
    const testUser = await createTestUser();
    const subscriptionId = `sub_${crypto.randomUUID()}`;
    const createdPayload = JSON.stringify(
      buildSubscriptionEvent("customer.subscription.created", {
        id: subscriptionId,
        status: "active",
        customer: "cus_teste_webhook",
        metadata: { userId: testUser.id },
      })
    );
    await postWebhook(createdPayload, sign(createdPayload));

    const deletedPayload = JSON.stringify(
      buildSubscriptionEvent("customer.subscription.deleted", {
        id: subscriptionId,
        status: "canceled",
        customer: "cus_teste_webhook",
      })
    );
    const response = await postWebhook(deletedPayload, sign(deletedPayload));
    expect(response.status).toBe(200);

    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
    expect(row.status).toBe("canceled");
  });
});
```

- [ ] **Step 3: Rodar para confirmar que falha**

Run: `npm test -- stripe-webhook-api`
Expected: FAIL (rota não existe).

- [ ] **Step 4: Implementar a rota**

Create `app/api/stripe/webhook/route.ts`:

```ts
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";
import { db } from "@/lib/db";
import { subscriptions } from "@/db/schema";

const VALID_STATUSES = ["trialing", "active", "past_due", "canceled", "incomplete"] as const;
type SubscriptionStatus = (typeof VALID_STATUSES)[number];

function toSubscriptionStatus(status: string): SubscriptionStatus {
  return (VALID_STATUSES as readonly string[]).includes(status)
    ? (status as SubscriptionStatus)
    : "incomplete";
}

async function upsertSubscription(sub: Stripe.Subscription) {
  const currentPeriodEnd = new Date(sub.items.data[0].current_period_end * 1000);
  const status = toSubscriptionStatus(sub.status);

  const [existing] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, sub.id));

  if (existing) {
    await db
      .update(subscriptions)
      .set({ status, currentPeriodEnd })
      .where(eq(subscriptions.stripeSubscriptionId, sub.id));
    return;
  }

  const userId = sub.metadata?.userId;
  if (!userId) return;

  await db.insert(subscriptions).values({
    id: crypto.randomUUID(),
    userId,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    status,
    currentPeriodEnd,
  });
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json({ error: "Webhook não configurado" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();
  const stripe = getStripeClient();

  let event: Stripe.Event;
  try {
    if (!signature) throw new Error("Assinatura ausente");
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return Response.json({ error: "Assinatura inválida" }, { status: 400 });
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated"
  ) {
    await upsertSubscription(event.data.object as Stripe.Subscription);
  } else if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    await db
      .update(subscriptions)
      .set({ status: "canceled" })
      .where(eq(subscriptions.stripeSubscriptionId, sub.id));
  }

  return Response.json({ received: true });
}
```

Nota de design (diverge levemente da spec, propositalmente): a spec original lista
`checkout.session.completed` como um dos três eventos tratados. Esta implementação
trata `customer.subscription.created` no lugar dele — a Stripe sempre emite esse
evento, com o objeto `Subscription` completo (incluindo `metadata.userId`, herdado de
`subscription_data.metadata` passado no checkout da Task 4) já disponível, sem
precisar de uma segunda chamada de rede (`stripe.subscriptions.retrieve`) para buscar
o que `checkout.session.completed` só traria por referência. Resultado prático
idêntico ao pretendido pela spec (a assinatura é criada em `subscriptions` assim que o
checkout é concluído), com menos uma chamada de rede e mais fácil de testar sem mock.

- [ ] **Step 5: Rodar os testes de novo**

Run: `npm test -- stripe-webhook-api`
Expected: 4 testes passando.

- [ ] **Step 6: Rodar lint, build e typecheck**

Run: `npm run lint && npx next build && npx tsc --noEmit`
Expected: sem erros. Preste atenção especial aqui: se o Step 1 identificou que o
campo correto é `sub.current_period_end` em vez de `sub.items.data[0].current_period_end`,
um erro de tipo nesta rota é o sinal de que o ajuste não foi feito.

- [ ] **Step 7: Commit**

```bash
git add app/api/stripe/webhook/route.ts tests/stripe-webhook-api.test.ts
git commit -m "feat: adiciona POST /api/stripe/webhook"
```

---

### Task 7: Gate em `POST /api/practice/attempts`

**Files:**
- Modify: `app/api/practice/attempts/route.ts`
- Test: modify `tests/practice-attempts-api.test.ts`

**Interfaces:**
- Consumes: `canPracticeToday` de `@/lib/entitlements` (Task 3).

- [ ] **Step 1: Adicionar o teste do limite ao final do `describe` existente**

`tests/practice-attempts-api.test.ts` já importa `db`, `attempts` e define
`createUserCookie()` (retorna `{cookie, userId}`) e `createApprovedQuestion()`
(cria um tópico + uma questão `status: "aprovada"` e devolve a questão). Adicione
este teste dentro do `describe("POST /api/practice/attempts", ...)` existente, logo
depois do último `it(...)`:

```ts
  it("retorna 402 ao atingir o limite diário do plano grátis", async () => {
    const question = await createApprovedQuestion();
    const { cookie, userId } = await createUserCookie();

    for (let i = 0; i < 20; i++) {
      await db.insert(attempts).values({
        id: crypto.randomUUID(),
        questionId: question.id,
        userId,
        selectedAnswer: "A",
        isCorrect: true,
      });
    }

    const request = new Request("http://localhost:3000/api/practice/attempts", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: question.id, selectedAnswer: "A" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(402);
  });
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `npm test -- practice-attempts-api`
Expected: FAIL (o novo teste espera 402, a rota ainda retorna 200).

- [ ] **Step 3: Adicionar o gate na rota**

Em `app/api/practice/attempts/route.ts`, adicione o import e a checagem logo após o
bloco `if (!session) { ... }` existente:

```ts
import { canPracticeToday } from "@/lib/entitlements";
```

```ts
  if (!(await canPracticeToday(session.user.id))) {
    return Response.json(
      {
        error:
          "Limite diário de questões do plano grátis atingido. Assine o Premium para praticar sem limite.",
      },
      { status: 402 }
    );
  }
```

- [ ] **Step 4: Rodar os testes de novo**

Run: `npm test -- practice-attempts-api`
Expected: todos os testes do arquivo passando, incluindo o novo.

- [ ] **Step 5: Commit**

```bash
git add app/api/practice/attempts/route.ts tests/practice-attempts-api.test.ts
git commit -m "feat: aplica limite diário de prática no plano grátis"
```

---

### Task 8: Gate em `POST /api/simulados`

**Files:**
- Modify: `app/api/simulados/route.ts`
- Test: modify `tests/simulados-create-api.test.ts`

**Interfaces:**
- Consumes: `canStartSimulado` de `@/lib/entitlements` (Task 3).

- [ ] **Step 1: Adicionar o teste do limite**

`tests/simulados-create-api.test.ts` já importa `db` e `simulados` de `@/db/schema`
e define `createUserCookie()` (retorna `{cookie, userId}`). Este teste não precisa de
nenhuma questão aprovada — o gate roda antes de qualquer checagem de disponibilidade,
então basta já existir 1 simulado do usuário. Adicione dentro do
`describe("POST /api/simulados", ...)` existente, logo depois do último `it(...)`:

```ts
  it("retorna 402 ao tentar iniciar um segundo simulado no plano grátis", async () => {
    const { cookie, userId } = await createUserCookie();
    await db.insert(simulados).values({
      id: crypto.randomUUID(),
      userId,
      mode: "mesclado",
      examDay: 1,
      questionIds: [],
      durationSeconds: 100,
    });

    const request = new Request("http://localhost:3000/api/simulados", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "mesclado", examDay: 1 }),
    });
    const response = await POST(request);
    expect(response.status).toBe(402);
  });
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `npm test -- simulados-create-api`
Expected: FAIL (o novo teste espera 402; sem o gate a rota tentaria validar
disponibilidade normalmente e provavelmente retornaria 400 por falta de questões,
não 402).

- [ ] **Step 3: Adicionar o gate na rota**

Em `app/api/simulados/route.ts`, adicione o import:

```ts
import { canStartSimulado } from "@/lib/entitlements";
```

E a checagem logo após o `if (!session) { ... }` da função `POST` (antes do parse do
body):

```ts
  if (!(await canStartSimulado(session.user.id))) {
    return Response.json(
      {
        error: "Limite de simulados do plano grátis atingido. Assine o Premium para simulados sem limite.",
      },
      { status: 402 }
    );
  }
```

Não mexa na função `GET` do mesmo arquivo — listar/ver simulados já criados nunca é
limitado, só a criação de um novo.

- [ ] **Step 4: Rodar os testes de novo**

Run: `npm test -- simulados-create-api`
Expected: todos os testes do arquivo passando.

- [ ] **Step 5: Commit**

```bash
git add app/api/simulados/route.ts tests/simulados-create-api.test.ts
git commit -m "feat: aplica limite de simulados no plano grátis"
```

---

### Task 9: Gate em `POST /api/redacao/redacoes`

**Files:**
- Modify: `app/api/redacao/redacoes/route.ts`
- Test: modify `tests/redacao-create-api.test.ts`

**Interfaces:**
- Consumes: `canSubmitRedacao` de `@/lib/entitlements` (Task 3).

- [ ] **Step 1: Adicionar o teste do limite**

Adicione ao `describe` de `tests/redacao-create-api.test.ts` (reaproveitando os
helpers `createUserCookie`/`createTema` já existentes no arquivo, mostrados
anteriormente neste projeto):

```ts
  it("retorna 402 ao atingir o limite mensal de correções no plano grátis", async () => {
    const cookie = await createUserCookie();
    const tema = await createTema();

    // primeira correção consome a cota grátis de 1/mês
    vi.mocked(gradeRedacao).mockResolvedValue({
      scores: { competencia1: 0, competencia2: 0, competencia3: 0, competencia4: 0, competencia5: 0 },
      notaTotal: 0,
      feedback: { justificativas: ["", "", "", "", ""], comentarioGeral: "" },
    });
    const first = new Request("http://localhost:3000/api/redacao/redacoes", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ temaId: tema.id, text: LONG_ENOUGH_TEXT }),
    });
    await POST(first);

    const second = new Request("http://localhost:3000/api/redacao/redacoes", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ temaId: tema.id, text: LONG_ENOUGH_TEXT }),
    });
    const response = await POST(second);
    expect(response.status).toBe(402);
  });
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `npm test -- redacao-create-api`
Expected: FAIL (o novo teste espera 402 na segunda chamada; sem o gate, a segunda
correção seria aceita normalmente).

- [ ] **Step 3: Adicionar o gate na rota**

Em `app/api/redacao/redacoes/route.ts`, adicione o import:

```ts
import { canSubmitRedacao } from "@/lib/entitlements";
```

E a checagem logo após o `if (!session) { ... }` na função `POST`, **antes** da
validação de tamanho do texto e antes de qualquer chamada a `gradeRedacao` (evita
gastar uma chamada paga à Claude quando o usuário já está sem cota):

```ts
  if (!(await canSubmitRedacao(session.user.id))) {
    return Response.json(
      { error: "Limite de correções do mês atingido. Assine o Premium para mais correções." },
      { status: 402 }
    );
  }
```

- [ ] **Step 4: Rodar os testes de novo**

Run: `npm test -- redacao-create-api`
Expected: todos os testes do arquivo passando.

- [ ] **Step 5: Rodar a suíte completa**

Run: `npm test`
Expected: tudo passando (todas as Tasks 1-9 juntas).

- [ ] **Step 6: Commit**

```bash
git add app/api/redacao/redacoes/route.ts tests/redacao-create-api.test.ts
git commit -m "feat: aplica limite mensal de correções de redação no plano grátis"
```

---

### Task 10: `/api/me` com `plan`, `Header.tsx` e página `/planos`

**Files:**
- Modify: `app/api/me/route.ts`
- Modify: `app/components/Header.tsx`
- Create: `app/planos/page.tsx`

**Interfaces:**
- Consumes: `getUserPlan` de `@/lib/entitlements` (Task 3).
- Produces: `GET /api/me` agora inclui `plan: "free" | "premium"` na resposta — consumido por `Header.tsx` e por `/planos`.

- [ ] **Step 1: Adicionar `plan` a `GET /api/me`**

Modify `app/api/me/route.ts` para:

```ts
import { auth } from "@/lib/auth";
import { getUserPlan } from "@/lib/entitlements";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const plan = await getUserPlan(session.user.id);

  return Response.json({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    plan,
  });
}
```

- [ ] **Step 2: Verificar manualmente que a mudança não quebra nada que já lê `/api/me`**

Run: `grep -rn "api/me" app/ --include=*.tsx`
Confirme quais componentes já chamam essa rota hoje e que nenhum deles vai quebrar por
ganhar um campo `plan` extra na resposta (adicionar um campo novo a um JSON existente
é sempre seguro para quem só lê os campos que já conhecia).

- [ ] **Step 3: Atualizar `Header.tsx`**

Replace o conteúdo de `app/components/Header.tsx` por:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function Header() {
  const router = useRouter();
  const { data, isPending } = authClient.useSession();
  const [plan, setPlan] = useState<"free" | "premium" | null>(null);

  useEffect(() => {
    if (!data?.user) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    fetch("/api/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled && body) setPlan(body.plan);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [data?.user]);

  async function handleSignOut() {
    try {
      await authClient.signOut();
      router.push("/");
      router.refresh();
    } catch (error) {
      console.error("Erro ao sair:", error);
    }
  }

  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <Link href="/" className="font-semibold">
        Plataforma ENEM
      </Link>

      {isPending ? null : data?.user ? (
        <div className="flex items-center gap-3 text-sm">
          <Button render={<Link href="/pratica">Praticar</Link>} variant="link" />
          <Button render={<Link href="/simulados">Simulados</Link>} variant="link" />
          <Button render={<Link href="/redacao">Redação</Link>} variant="link" />
          {plan === "premium" ? (
            <span className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
              Premium
            </span>
          ) : (
            <Button render={<Link href="/planos">Planos</Link>} variant="link" />
          )}
          <span>{data.user.name}</span>
          <Button type="button" variant="outline" size="sm" onClick={handleSignOut}>
            Sair
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-sm">
          <Button render={<Link href="/planos">Planos</Link>} variant="link" />
          <Button render={<Link href="/entrar">Entrar</Link>} variant="link" />
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 4: Criar a página `/planos`**

Create `app/planos/page.tsx`:

```tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

function PlanosContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [plan, setPlan] = useState<"free" | "premium" | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sucesso = searchParams.get("sucesso") === "1";

  useEffect(() => {
    fetch("/api/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setPlan(body?.plan ?? null))
      .finally(() => setLoadingPlan(false));
  }, []);

  async function handleAssinar() {
    setRedirecting(true);
    setError(null);
    try {
      const response = await fetch("/api/stripe/checkout", { method: "POST" });
      if (response.status === 401) {
        router.push("/entrar");
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Não foi possível iniciar o checkout.");
        setRedirecting(false);
        return;
      }
      const body = await response.json();
      window.location.href = body.url;
    } catch {
      setError("Não foi possível iniciar o checkout.");
      setRedirecting(false);
    }
  }

  async function handleGerenciar() {
    setRedirecting(true);
    setError(null);
    try {
      const response = await fetch("/api/stripe/portal", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Não foi possível abrir o portal de assinatura.");
        setRedirecting(false);
        return;
      }
      const body = await response.json();
      window.location.href = body.url;
    } catch {
      setError("Não foi possível abrir o portal de assinatura.");
      setRedirecting(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8">
      <h1 className="text-2xl font-semibold">Planos</h1>

      {sucesso && (
        <p className="rounded border border-green-600 bg-green-50 p-3 text-sm text-green-800">
          Assinatura confirmada! Pode levar alguns instantes para liberar no seu acesso.
        </p>
      )}
      {error && <p className="text-destructive">{error}</p>}

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <p className="text-lg font-medium">Grátis</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>20 questões de prática por dia</p>
            <p>1 simulado</p>
            <p>1 correção de redação por mês</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <p className="text-lg font-medium">Premium — R$ 29,90/mês</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground">
            <div className="flex flex-col gap-2">
              <p>Questões de prática sem limite</p>
              <p>Simulados sem limite</p>
              <p>20 correções de redação por mês</p>
            </div>
            {!loadingPlan &&
              (plan === "premium" ? (
                <Button type="button" disabled={redirecting} onClick={handleGerenciar}>
                  Gerenciar assinatura
                </Button>
              ) : (
                <Button type="button" disabled={redirecting} onClick={handleAssinar}>
                  Assinar
                </Button>
              ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default function PlanosPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-8">Carregando...</main>}>
      <PlanosContent />
    </Suspense>
  );
}
```

`useSearchParams` exige um `<Suspense>` em volta (confirmado em `next build` neste
projeto durante o subsistema 2.6 — sem isso o build quebra com um erro real de
prerender), por isso o componente principal é envolto por `Suspense`.

- [ ] **Step 5: Rodar lint, build e typecheck**

Run: `npm run lint && npx next build && npx tsc --noEmit`
Expected: sem erros, incluindo nenhum erro de prerender em `/planos`.

- [ ] **Step 6: Commit**

```bash
git add app/api/me/route.ts app/components/Header.tsx app/planos/page.tsx
git commit -m "feat: adiciona pagina /planos e indicador de plano no Header"
```

---

### Task 11: UX de limite atingido (402) nas 3 páginas de uso

**Files:**
- Modify: `app/pratica/[subject]/[topicId]/page.tsx`
- Modify: `app/simulados/page.tsx`
- Modify: `app/redacao/[temaId]/page.tsx`

**Interfaces:**
- Nenhuma nova — só consome a mensagem de erro que as Tasks 7, 8 e 9 já retornam no
  corpo de uma resposta 402.

- [ ] **Step 1: `app/pratica/[subject]/[topicId]/page.tsx`**

Adicione um novo state logo abaixo de `const [attemptError, setAttemptError] = useState<string | null>(null);`:

```tsx
  const [limitReached, setLimitReached] = useState(false);
```

Em `handleAnswer`, dentro do `try`, logo após o bloco `if (response.status === 401) { ... }`
e **antes** do bloco `if (!response.ok) { ... }` existente, adicione:

```tsx
      if (response.status === 402) {
        const data = await response.json().catch(() => null);
        setAttemptError(data?.error ?? "Limite do plano grátis atingido.");
        setLimitReached(true);
        return;
      }
```

No topo de `handleAnswer`, junto de `setAttemptError(null);`, adicione
`setLimitReached(false);` para o estado não "vazar" de uma tentativa anterior.

No JSX, logo depois de `{attemptError && <p className="text-sm text-destructive">{attemptError}</p>}`,
adicione:

```tsx
      {limitReached && (
        <Link href="/planos" className="text-sm underline">
          Ver planos
        </Link>
      )}
```

`Link` já está importado no topo do arquivo (usado no resto da página).

- [ ] **Step 2: `app/simulados/page.tsx`**

Adicione um novo state logo abaixo de `const [creating, setCreating] = useState(false);`:

```tsx
  const [limitReached, setLimitReached] = useState(false);
```

Em `handleStart`, dentro do `try`, logo após o bloco `if (response.status === 401) { ... }`
e **antes** do bloco `if (!response.ok) { ... }` existente, adicione:

```tsx
      if (response.status === 402) {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? "Limite do plano grátis atingido.");
        setLimitReached(true);
        return;
      }
```

No topo de `handleStart`, junto de `setError(null);`, adicione `setLimitReached(false);`.

No JSX, logo depois de `{error && <p className="text-destructive">{error}</p>}`, adicione:

```tsx
      {limitReached && (
        <Link href="/planos" className="text-sm underline">
          Ver planos
        </Link>
      )}
```

`Link` já está importado no topo do arquivo.

- [ ] **Step 3: `app/redacao/[temaId]/page.tsx`**

Adicione um novo state logo abaixo de `const [error, setError] = useState<string | null>(null);`:

```tsx
  const [limitReached, setLimitReached] = useState(false);
```

Em `handleSubmit`, substitua o bloco:

```tsx
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Erro ao corrigir a redação." }));
        throw new ApiError(body.error ?? "Erro ao corrigir a redação.");
      }
```

por:

```tsx
      if (response.status === 402) {
        const body = await response.json().catch(() => ({ error: "Limite do plano grátis atingido." }));
        setLimitReached(true);
        throw new ApiError(body.error ?? "Limite do plano grátis atingido.");
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Erro ao corrigir a redação." }));
        throw new ApiError(body.error ?? "Erro ao corrigir a redação.");
      }
```

No topo de `handleSubmit`, junto de `setError(null);`, adicione `setLimitReached(false);`.

No JSX, logo depois de `{error && <p className="text-destructive">{error}</p>}`, adicione:

```tsx
      {limitReached && (
        <Link href="/planos" className="text-sm underline">
          Ver planos
        </Link>
      )}
```

E adicione `Link` aos imports do topo do arquivo (ainda não é usado nesta página):

```tsx
import Link from "next/link";
```

- [ ] **Step 4: Rodar lint, build e typecheck**

Run: `npm run lint && npx next build && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Rodar a suíte completa de novo**

Run: `npm test`
Expected: tudo passando — esta task não muda nenhuma rota de API, só UI, então
nenhum teste deveria ter sido afetado, mas confirme mesmo assim.

- [ ] **Step 6: Verificação manual em navegador (não existe teste automatizado de
componente React neste projeto — mesmo padrão de todas as tasks de UI anteriores,
verificado pessoalmente pelo controller, não apenas reportado por um subagent)**

Isso é feito pelo controller depois que todas as tasks deste plano estiverem
completas, cobrindo o fluxo ponta a ponta (ver seção de verificação final do
processo de subagent-driven-development), não precisa ser repetido aqui por task.

- [ ] **Step 7: Commit**

```bash
git add app/pratica/\[subject\]/\[topicId\]/page.tsx app/simulados/page.tsx app/redacao/\[temaId\]/page.tsx
git commit -m "feat: mostra aviso e link para /planos ao atingir limite do plano gratis"
```

---

### Task 12: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Adicionar uma seção ao final do arquivo**

Adicione ao final de `README.md`:

```markdown

## Monetização (planos)

Todo aluno começa no plano Grátis: 20 questões de prática por dia, 1 simulado, 1
correção de redação por mês. O plano Premium (R$ 29,90/mês, via Stripe) remove os
dois primeiros limites e eleva o de redação para 20/mês. `/planos` mostra os dois
planos e o botão de assinar/gerenciar.

Para testar o fluxo de pagamento localmente:

1. Crie uma conta de teste na Stripe (dashboard.stripe.com) e fique em modo teste.
2. Crie um Product + Price recorrente mensal, copie o ID do Price.
3. Configure no `.env.local`: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_PREMIUM` (o ID
   copiado acima).
4. Rode `stripe listen --forward-to localhost:3000/api/stripe/webhook` (Stripe CLI)
   — ele imprime um `whsec_...` de teste; coloque em `STRIPE_WEBHOOK_SECRET` no
   `.env.local`.
5. `npm run dev`, vá em `/planos`, clique em "Assinar", use o cartão de teste da
   própria Stripe `4242 4242 4242 4242` (qualquer data futura e CVC).

Em produção, os mesmos três valores (em modo live, não teste) vão nas variáveis de
ambiente do Vercel, e o endpoint de webhook é registrado no dashboard da Stripe
apontando para `https://plataforma-enem-rose.vercel.app/api/stripe/webhook`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: documenta o subsistema de monetizacao no README"
```

---

## Verificação final (não é uma task numerada — parte do fechamento do plano)

Depois da Task 12, antes de considerar o subsistema pronto:

1. `npm run lint && npx next build && npx tsc --noEmit && npm test` — tudo verde.
2. Controller (não um subagent) dirige um navegador real: logar, ir em `/planos`
   (vendo o card Grátis e o card Premium com botão "Assinar"), esgotar o limite
   diário de prática (20 respostas) e confirmar que a 21ª mostra o aviso + link
   "Ver planos", esgotar o simulado único e confirmar o aviso ao tentar um segundo,
   esgotar a correção de redação do mês e confirmar o aviso na segunda tentativa.
   Como não há `STRIPE_SECRET_KEY` real neste ambiente (ver bloqueio conhecido na
   spec), o clique em "Assinar" vai falhar na chamada real à Stripe — isso é
   esperado e não é um defeito desta implementação, só confirma que a UI trata o
   erro sem quebrar (mensagem de erro visível, botão volta a ficar clicável).
