@AGENTS.md

# Workflow deste projeto

Todo subsistema novo segue o ciclo completo do superpowers, sempre nesta ordem:

- `/superpowers:brainstorming` → `/superpowers:writing-plans` →
  `/superpowers:subagent-driven-development` → `/superpowers:finishing-a-development-branch`
- `/superpowers:using-git-worktrees` — cada subsistema numa worktree isolada em `.worktrees/<nome>`, nunca direto em `main`
- Tasks do plano genuinamente independentes (arquivos disjuntos, sem
  `Depends-on` entre si) podem rodar em onda paralela — regra completa em
  `.claude/rules/parallel-subagent-driven-development.md`
- TDD dentro de cada tarefa do plano (teste falha → implementa → teste passa)
- `/superpowers:systematic-debugging` sempre que aparecer um bug real durante a implementação, antes de propor qualquer correção
- O template de review de `/superpowers:requesting-code-review` para a revisão final de cada branch, antes do PR
- PR no GitHub ao final (`finishing-a-development-branch` cuida disso) → auditar com `/pr-audit` → só então merge

**Brainstorm pode rodar em paralelo, implementação não.** Especificar o
design de vários subsistemas ao mesmo tempo (em conversas/sessões
diferentes) é seguro — é só pergunta e escrita de spec, não toca em banco
nem em código. Mas a partir de `writing-plans` em diante (migrations,
`npm run db:generate`/`db:migrate`, testes), só um subsistema por vez: todas
as worktrees deste repo compartilham o mesmo Postgres local
(`fundacao-postgres-1`) e a mesma sequência de migrations — rodar duas
implementações ao mesmo tempo gera migrations com números conflitantes e
dados de teste cruzados entre sessões. Regra prática: pode ter várias specs
prontas esperando, mas só uma branch de implementação aberta por vez —
mergeie uma antes de começar o plano da próxima.

## Stack

Next.js 15 (App Router) + TypeScript · Postgres via Drizzle ORM · Better Auth
(email/senha) · Stripe (assinatura freemium) · Claude API (correção de
redação) + Gemini (classificação de questões na ingestão) · Tailwind +
shadcn/ui (Base UI, não Radix) · Vercel + Supabase.

## Comandos canônicos

- **Install:** `npm install`
- **Lint:** `npm run lint`
- **Typecheck:** `npx tsc --noEmit`
- **Test:** `npm test` (Vitest, contra o Postgres local real, sem mocks de banco)
- **Build:** `npm run build`
- **Dev:** `npm run dev`

Ordem obrigatória ao rodar os três juntos: `npm run lint && npx next build
&& npx tsc --noEmit` — build antes de typecheck, porque `next build` gera
`.next/types` que `app/layout.tsx` precisa; typecheck sozinho sem build
prévio acusa um erro falso em `LayoutProps`.

## Convenções

- UI inteiramente em português, sem texto em inglês visível ao usuário.
- Rotas de API: `requireUser(request)` de `lib/session.ts` para auth;
  paginação `page`/`pageSize`/`total`; 401 sem sessão, 404 (não 403) pra não
  vazar existência de recurso de outro usuário, 402 pra limite de plano.
- Chaves de serviço externo (Gemini/Claude/Stripe) ficam fora do
  `envSchema` estrito de `lib/env.ts` — lidas direto de `process.env` num
  client de inicialização preguiçosa (`lib/gemini.ts`, `lib/anthropic.ts`,
  `lib/stripe.ts` são o mesmo padrão, copie dali pra qualquer serviço novo).
- Lógica de negócio compartilhada (ex.: `lib/entitlements.ts`) é o único
  lugar que decide a regra — nunca duplicar a checagem numa rota.

## Roteamento de especialistas

Trabalho delegável vai pro especialista cuja descrição bate com a tarefa
(arquivos reais em `.claude/agents/`, não um agente genérico):

| Especialista | Quando usar |
|---|---|
| `backend-specialist` | Rota de API (`app/api/**/route.ts`), lógica de servidor, integração com Stripe/Claude/Gemini. |
| `frontend-specialist` | Página, componente de UI, layout, interação. |
| `database-architect` | Schema (`db/schema.ts`), migration, índice, estratégia de query. |
| `security-reviewer` | Antes de qualquer merge tocando auth, pagamento, entrada do usuário ou segredo. |
| `test-engineer` | Escrever/reforçar cobertura de teste depois de lógica nova. |
| `code-reviewer` | Revisão por task, depois de qualquer edição de código-fonte. |

