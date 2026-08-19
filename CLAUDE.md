@AGENTS.md

# Workflow deste projeto

Todo subsistema novo segue o ciclo completo do superpowers, sempre nesta ordem:

- `/superpowers:brainstorming` → `/superpowers:writing-plans` →
  `/superpowers:subagent-driven-development` → `/superpowers:finishing-a-development-branch`
- `/superpowers:using-git-worktrees` — cada subsistema numa worktree isolada em `.worktrees/<nome>`, nunca direto em `main`
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

