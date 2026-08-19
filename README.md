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
