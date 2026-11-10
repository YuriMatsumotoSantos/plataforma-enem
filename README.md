# Plataforma ENEM

[English version below](#english)

Plataforma de estudos para o ENEM: banco de questões, prática por assunto, simulados e correção de redação com IA. Projeto pessoal, nascido como extensão da minha Iniciação Científica sobre correção automática de redações.

**Estado: em desenvolvimento, pausado desde setembro de 2026.** Parei para me dedicar à Iniciação Científica e ao TCC. O que está descrito abaixo funciona em ambiente local. A versão publicada em produção está desatualizada.

## O que já funciona

- Autenticação, banco PostgreSQL com migrações, headers de segurança, testes de integração e CI.
- Pipeline de ingestão: baixa as provas, extrai e classifica as questões com a API do Gemini e grava tudo como pendente.
- Fila de revisão humana em `/admin/revisao`, para aprovar, corrigir ou rejeitar cada questão antes de ela chegar ao aluno.
- Prática por assunto com feedback imediato e registro das tentativas.
- Planos Grátis e Premium com limites de uso, integrados à Stripe em modo de teste.

## O que falta

- Dashboard e recomendação adaptativa a partir das tentativas gravadas.
- Atualizar a versão publicada em produção.

## Stack

Next.js 16, React 19, TypeScript, PostgreSQL com Drizzle, Better Auth, Supabase Storage, API do Gemini, Stripe, Vitest, ESLint e Biome.

## Pré-requisitos

- Node.js 20+
- Docker (para o Postgres local)

## Configuração

```bash
cp .env.example .env.local   # ajuste os valores se necessário
docker compose up -d         # sobe o Postgres local
npm install
npx drizzle-kit migrate      # ou: npm run db:migrate
npm run dev
```

O app fica disponível em `http://localhost:3000`.

> O Postgres local do Docker Compose expõe a porta **5433** no host (não 5432),
> para não colidir com uma instalação nativa do Postgres. A connection string
> em `.env.example` já reflete isso.

## Testes

```bash
npm test
```

Os testes de integração (`auth`, `protected-route`, `db`) rodam contra o Postgres
do Docker Compose — confirme que ele está no ar antes de rodar `npm test`.

## Scripts úteis

- `npm run dev` — servidor de desenvolvimento
- `npm run build` — build de produção
- `npm run lint` / `npm run typecheck` — checagens estáticas
- `npm run db:generate` / `npm run db:migrate` — gera/aplica migrações do Drizzle

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

## Prática por assunto

Qualquer aluno logado (não precisa ser `admin`) acessa `/pratica`, escolhe uma
matéria e um assunto, e responde questões aprovadas uma de cada vez, com
feedback imediato. Cada tentativa é gravada na tabela `attempts` — hoje
nenhuma tela lê esses dados, é preparação para o dashboard/recomendação
adaptativa (subsistema futuro).

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

---

## English

Study platform for ENEM, the Brazilian national high school exam: question bank, practice by topic, mock exams and AI essay grading. A personal project that started as an extension of my undergraduate research on automated essay scoring.

**Status: in development, paused since September 2026.** I stopped to focus on my research project and my final thesis. What is described below works in a local environment. The version deployed to production is out of date.

### What already works

- Authentication, PostgreSQL database with migrations, security headers, integration tests and CI.
- Ingestion pipeline: downloads the exams, extracts and classifies the questions with the Gemini API and stores everything as pending.
- Human review queue at `/admin/revisao`, to approve, fix or reject each question before it reaches a student.
- Practice by topic with immediate feedback and a record of every attempt.
- Free and Premium plans with usage limits, integrated with Stripe in test mode.

### What is missing

- Dashboard and adaptive recommendation built on the recorded attempts.
- Updating the version deployed to production.

### Stack

Next.js 16, React 19, TypeScript, PostgreSQL with Drizzle, Better Auth, Supabase Storage, Gemini API, Stripe, Vitest, ESLint and Biome.

### Requirements

- Node.js 20+
- Docker (for the local Postgres)

### Setup

```bash
cp .env.example .env.local   # adjust the values if needed
docker compose up -d         # starts the local Postgres
npm install
npx drizzle-kit migrate      # or: npm run db:migrate
npm run dev
```

The app runs at `http://localhost:3000`. The local Postgres from Docker Compose is exposed on port **5433** (not 5432), so it does not clash with a native Postgres install. The connection string in `.env.example` already reflects that.

### Tests

```bash
npm test
```

The integration tests (`auth`, `protected-route`, `db`) run against the Docker Compose Postgres, so make sure it is up before running `npm test`.

### Useful scripts

- `npm run dev`: development server
- `npm run build`: production build
- `npm run lint` / `npm run typecheck`: static checks
- `npm run db:generate` / `npm run db:migrate`: generate and apply Drizzle migrations

### Question curation (ENEM question bank)

Local ingestion pipeline. It does not run on the production site, only on your machine.

1. Set the variables in `.env.local`: `GEMINI_API_KEY` (aistudio.google.com), `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Supabase dashboard, Project Settings, API).
2. Make sure the `question-images` bucket exists in Supabase Storage (public).
3. Run `npm run ingest`. It downloads the 2025 exams, extracts and classifies the questions with Gemini, and stores everything with status `pendente` (takes about 15 to 20 minutes).
4. Open `/admin/revisao` logged in with an `admin` account (set `role = 'admin'` in the `user` table) to approve, fix or reject each extracted question.

### Practice by topic

Any logged-in student (no `admin` role needed) opens `/pratica`, picks a subject and a topic, and answers approved questions one at a time, with immediate feedback. Each attempt is stored in the `attempts` table. No screen reads that data yet. It is groundwork for the dashboard and adaptive recommendation.

### Plans

Every student starts on the Free plan: 20 practice questions per day, 1 mock exam and 1 essay grading per month. The Premium plan (R$ 29.90 per month, through Stripe) removes the first two limits and raises essay grading to 20 per month. `/planos` shows both plans and the button to subscribe or manage.

To test the payment flow locally:

1. Create a Stripe test account (dashboard.stripe.com) and stay in test mode.
2. Create a Product with a recurring monthly Price and copy the Price ID.
3. Set `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID_PREMIUM` (the ID you copied) in `.env.local`.
4. Run `stripe listen --forward-to localhost:3000/api/stripe/webhook` (Stripe CLI). It prints a test `whsec_...` value. Put it in `STRIPE_WEBHOOK_SECRET` in `.env.local`.
5. Run `npm run dev`, open `/planos`, click "Assinar" and use Stripe's own test card `4242 4242 4242 4242` (any future date and CVC).
