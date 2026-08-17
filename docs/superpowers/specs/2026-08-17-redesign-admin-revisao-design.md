# Redesenho visual + paginação + edição — Design

**Data:** 2026-08-17
**Status:** Aprovado para planejamento de implementação

## Contexto e motivação

Depois do PR de login/cadastro ser mergeado, o founder criou sua conta real e acessou `/admin/revisao` para começar a curadoria das 180 questões reais do ENEM 2025 já extraídas. A tela, construída como MVP mínimo (Task 11 do subsistema Banco de questões), usa só HTML puro com estilo inline — sem framework visual, sem paginação (carrega as ~180 questões pendentes de uma vez na mesma página), e sem função de editar (só Aprovar/Rejeitar), mesmo o spec original do produto prevendo "revisor só corrige o que estiver errado".

Isso ficou explicitamente inadequado para uso real: a tela é visualmente pobre, pesada de rolar, e força o revisor a rejeitar uma questão real por causa de um erro pequeno de classificação em vez de corrigi-lo.

Este documento cobre um redesenho das 3 telas já existentes do site (`/entrar`, cabeçalho compartilhado, `/admin/revisao`) usando shadcn/ui, mais duas mudanças funcionais na tela de revisão: paginação e edição.

## Ferramentas usadas

- **shadcn/ui + Tailwind** (já configurado no projeto, nunca usado até agora) — componentes instalados sob demanda via `npx shadcn add`, não a biblioteca inteira
- **Skill `ui-ux-pro-max`** (pacote de terceiros, instalado nesta sessão em `.claude/skills/`, inspecionado antes do uso — scripts não fazem chamada de rede além de URLs estáticas de banco de imagens, e a integração com shadcn roda só `npx shadcn add` local) — usada para o checklist de acessibilidade/interação (contraste, alvo de toque mínimo, foco visível, `prefers-reduced-motion`), não para o gerador de paleta/estilo (os resultados do gerador convergiram repetidamente para um padrão de "dashboard SaaS escuro com glassmorphism e fonte monoespaçada" inadequado para uma ferramenta de leitura de texto longo em português; a decisão de paleta/tipografia abaixo foi tomada diretamente, informada pelo uso real do produto)

## Escopo

- Redesenho visual das 3 telas já existentes (`/entrar`, `Header`, `/admin/revisao`) com shadcn/ui
- Paginação em `/admin/revisao` (20 questões por página)
- Função de editar em `/admin/revisao` (enunciado, alternativas, resposta correta, reclassificação de assunto)

Fora de escopo (decisões adiadas, não bloqueiam este subsistema):
- Criar um assunto/tópico novo pela tela (a reclassificação só permite escolher entre os 166 assuntos já existentes)
- Qualquer tela nova além das 3 já existentes
- Dark mode (tema claro fixo por enquanto)
- Filtro por área/matéria na tela de revisão (a API já suporta `?area=`, mas a UI não expõe esse filtro nesta fase)

## Sistema de design

- **Tema:** claro, fixo (sem dark mode nesta fase)
- **Cor base:** zinc (neutro, já usado nas telas atuais)
- **Cor de destaque:** azul — transmite confiança, comum em produtos educacionais brasileiros sérios
- **Tipografia:** mantém Geist (já carregada via `next/font` em `app/layout.tsx`), sem trocar fonte
- **Sem efeitos decorativos** (sem glassmorphism, sem blur, sem gradientes chamativos) — prioridade total é legibilidade para leitura de texto longo (enunciados de questões em português)
- Checklist de acessibilidade aplicado (via skill `ui-ux-pro-max`): contraste mínimo 4.5:1, alvo de toque mínimo 44×44px, foco visível em navegação por teclado, `prefers-reduced-motion` respeitado, sem emoji como ícone (usar SVG)

## Mudança de API — paginação

`GET /api/admin/questions` ganha dois query params novos, ambos opcionais:
- `page` (padrão `1`)
- `pageSize` (fixo em `20`, não configurável pelo cliente nesta fase)

Resposta muda de `{ questions: [...] }` para `{ questions: [...], total: number, page: number, pageSize: number }` — `total` é a contagem de questões que batem o filtro de `status`/`area`, sem paginação, para o cliente calcular o número de páginas.

`PATCH /api/admin/questions/:id` não muda — já suporta editar `statement`, `alternatives`, `correctAnswer`, `topicId`.

## Telas

### `/entrar`
Mesma lógica funcional do subsistema anterior (alternador login/cadastro, redirecionamento por role, mensagens de erro inline, proteção contra falha de rede) — só reconstruída visualmente com `Card`, `Input`, `Label`, `Button` do shadcn/ui.

### `Header`
Mesma lógica funcional (link "Entrar" deslogado, nome + "Sair" logado, via `authClient.useSession()`) — reconstruído com `Button` do shadcn/ui, mantendo a barra superior fixa.

### `/admin/revisao`
- Cada questão pendente é um `Card`: `Badge` de status, área/matéria/assunto, enunciado, lista de alternativas (a correta destacada visualmente), imagem se `imageUrl` estiver presente
- Três ações por card: **Aprovar** (`Button` padrão), **Rejeitar** (`Button` variante destrutiva), **Editar** (`Button` variante outline, abre um `Dialog`)
- **Modal de edição** (`Dialog`): campos para enunciado (`Textarea`), as 5 alternativas (`Input` por letra), resposta correta (`Input` — texto livre, precisa continuar aceitando o valor sentinela `"Anulado"` das questões oficialmente anuladas), e um `Select` para reclassificar o assunto, listando os 166 tópicos existentes agrupados por matéria. Salvar chama o `PATCH` já existente com os campos alterados.
- **Paginação** (`Pagination` do shadcn) no rodapé da lista: números de página + anterior/próxima, refletindo `total`/`page`/`pageSize` da API

## Testes

- **Paginação da API**: teste automatizado real contra Postgres (mesmo padrão já usado nas rotas existentes) — cobre `page`/`pageSize` default, página fora do intervalo, `total` correto
- **Modal de edição**: sem teste automatizado novo — consome o `PATCH` já testado; verificado manualmente
- **As 3 telas redesenhadas**: verificação manual via navegador real (mesmo padrão das sessões anteriores) — fluxos de login/cadastro/logout continuam funcionando, paginação navega corretamente, editar salva e reflete na lista, aprovar/rejeitar continuam funcionando, checklist básico de acessibilidade (foco visível, contraste, tamanho de alvo de toque)

## Self-Review Notes

- **Cobertura:** cobre as 3 telas + as 2 mudanças funcionais (paginação, edição) explicitamente pedidas. Escopo adiado (criar assunto novo, dark mode, filtro de área na UI) está listado explicitamente, não esquecido.
- **Consistência:** a lógica funcional de `/entrar` e `Header` (herdada do subsistema de login/cadastro) não muda, só a camada visual — evita reintroduzir bugs já corrigidos naquele subsistema (proteção contra falha de rede, redirecionamento por role).
- **Ferramenta de terceiros:** documentado explicitamente que o gerador de paleta da skill `ui-ux-pro-max` não foi usado como estava (resultados inadequados ao caso de uso), mas o checklist de acessibilidade/interação da mesma skill foi adotado — decisão registrada para não parecer inconsistente depois.
