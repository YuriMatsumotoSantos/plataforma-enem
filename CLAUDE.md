@AGENTS.md

# Workflow deste projeto

Todo subsistema novo segue o ciclo completo do superpowers, sempre nesta ordem:
`/superpowers:brainstorming` → `/superpowers:writing-plans` →
`/superpowers:subagent-driven-development` (numa worktree isolada em
`.worktrees/<nome>`) → PR no GitHub (nunca merge direto em `main`) → auditar
com `/pr-audit` → merge.

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

