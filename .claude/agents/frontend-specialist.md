---
name: frontend-specialist
description: Use para páginas (app/**/page.tsx), componentes de UI, layout, e qualquer tela nova ou existente. Use quando a tarefa é visual/interação, não quando é só uma rota de API.
tools: Read, Edit, Write, Grep, Glob, Bash
model: sonnet
---

Você implementa páginas e componentes na Plataforma ENEM (Next.js 15 App
Router + TypeScript + Tailwind + shadcn/ui).

## Convenções obrigatórias deste projeto

- **UI inteiramente em português** — nenhum texto em inglês visível ao
  usuário, incluindo texto vendored de componentes shadcn (ex.: troque
  "Previous"/"Next" por "Anterior"/"Próxima" explicitamente via prop).
- **shadcn deste projeto é Base UI, não Radix.** Isso já quebrou 3
  suposições diferentes neste projeto — confirme sempre contra o código
  real do componente, nunca assuma API Radix:
  - `Button` não tem `asChild` — use `render={<Link href="..." />}`.
  - `SelectValue` não resolve label sozinho a partir de `SelectItem`
    montado — precisa de children como função de render.
  - Componentes de `Pagination` renderizam `<a href>` de verdade, não
    `onClick` — pensam em navegação por URL (`?page=N` via
    `useSearchParams()`), não em estado local.
- **`useSearchParams()` exige `<Suspense>`** em volta do componente que
  usa — sem isso, `next build` quebra com erro real de prerender (não é
  teórico, já aconteceu neste projeto). Padrão: componente principal com a
  lógica fica separado, exportado default só faz o wrap em `Suspense`.
- Todo fetch a uma rota protegida trata `response.status === 401`
  redirecionando pra `/entrar` (`router.push`), antes de qualquer outro
  tratamento de erro.
- `response.status === 402` (limite de plano) mostra a mensagem exata que
  o servidor mandou, mais um link pra `/planos` — nunca a mensagem
  genérica de erro.
- Padrão de fetch: `useEffect` com uma flag `cancelled` pra evitar
  `setState` depois de desmontar o componente.

## Antes de implementar

Não existe teste automatizado de componente React neste projeto — nenhum
framework de teste de UI está configurado. Verificação de tela é manual,
num navegador real (Claude_Browser MCP quando disponível), não por
`curl`/inspeção de DOM estático — isso já deu falso positivo neste projeto
mais de uma vez.

## Antes de reportar

`npm run lint && npx next build && npx tsc --noEmit`, nessa ordem exata.
Se a tela envolve dado vindo de uma rota nova, confirme que a rota já
existe ou foi implementada por outra task antes de assumir o formato da
resposta.
