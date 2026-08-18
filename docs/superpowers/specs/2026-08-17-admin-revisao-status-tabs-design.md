# Abas de status em /admin/revisao — Design

**Data:** 2026-08-17
**Status:** Aprovado para planejamento de implementação

## Contexto e motivação

Pequeno complemento ao subsistema 2.6 (Redesenho + paginação + edição em `/admin/revisao`, já mergeado). Depois de aprovar boa parte das questões (73 aprovadas, 100 pendentes, 7 rejeitadas), o founder quer poder voltar mais tarde e revisar com calma, uma por uma, inclusive as que já foram aprovadas em massa (pra chegar a 100% de confiança) — mas a tela hoje só mostra `status=pendente`, sem jeito de ver aprovadas/rejeitadas.

## Escopo

- Abas "Pendentes / Aprovadas / Rejeitadas" no topo de `/admin/revisao`, cada uma com a contagem real de questões naquele status.
- Aba ativa refletida na URL (`?status=aprovada&page=1`), no mesmo padrão já usado pela paginação (`?page=N`).
- Botões Aprovar / Rejeitar / Editar continuam disponíveis em qualquer aba — permite corrigir uma decisão anterior (ex.: rejeitar algo que tinha sido aprovado em massa) sem sair da tela.
- Trocar de aba reseta a página para 1.

Fora de escopo: nenhuma mudança no backend — `GET /api/admin/questions` já aceita `status` como query param (`pendente`/`aprovada`/`rejeitada`), validado desde a implementação original. Esta é uma mudança só de frontend.

## Arquitetura

**`app/admin/revisao/page.tsx`** (modificar):
- Lê `status` de `useSearchParams()` (mesmo padrão já usado pra `page`), com fallback pra `"pendente"` quando ausente — preserva o comportamento atual como default.
- Busca a contagem de cada status: três chamadas a `GET /api/admin/questions?status=X&page=1` (reaproveitando o `total` que a rota já devolve), ou uma única chamada nova que devolva as três contagens de uma vez — decisão de implementação, não afeta o contrato externo da UI.
- Renderiza três abas/pills clicáveis (usando o componente `Tabs` do shadcn, já disponível no design system deste projeto — mesma família dos componentes já instalados em `components/ui/`); cada uma é um link que muda `?status=X&page=1`.
- `handleAction` (Aprovar/Rejeitar) continua funcionando igual, só que agora rebusca usando o `status` da aba atual em vez de sempre `"pendente"` hardcoded.

Nenhuma rota de API nova, nenhuma mudança de schema.

## Tratamento de erros

Mesmo padrão já existente na tela: 401 → mensagem de não autorizado; falha ao buscar contagens → aba mostra sem número em vez de quebrar a tela.

## Testes

Sem testes automatizados novos — a rota de API por trás (`GET /api/admin/questions?status=X`) já tem cobertura de teste existente para os três valores de status. Esta mudança é puramente de apresentação; verificação manual via navegador real: trocar entre as três abas, confirmar contagens corretas, aprovar uma questão a partir da aba "Rejeitadas" e confirmar que ela desaparece dali e aparece em "Aprovadas".

## Self-Review Notes

- **Cobertura:** cobre exatamente o pedido (ver aprovadas/rejeitadas, poder corrigir decisões) sem expandir escopo pra filtros adicionais (por matéria, por ano) não pedidos.
- **Consistência:** reaproveita a rota de API e o padrão de URL-driven state já estabelecidos no subsistema 2.6, sem introduzir um padrão novo.
- **Sem ambiguidade:** o único ponto deixado como "decisão de implementação" (uma chamada vs. três pra contar por status) é explicitamente marcado como não afetando o contrato externo — não é uma ambiguidade de requisito, é um detalhe de implementação.
