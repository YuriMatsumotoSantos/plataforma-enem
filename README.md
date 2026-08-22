# Plataforma ENEM

Base do app Next.js (autenticação, banco Postgres, headers de segurança e CI) sobre a qual os demais subsistemas serão construídos.

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
