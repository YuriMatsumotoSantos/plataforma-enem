# Monetização freemium — design

Status: aprovado (decisões tomadas autonomamente pelo usuário, ver nota de processo abaixo).

## Nota de processo

Esta spec foi escrita sem o ciclo normal de perguntas do `/superpowers:brainstorming`
porque o usuário pediu explicitamente, ao encerrar a sessão, para eu decidir tudo o
que fosse preciso decidir usando a opção mais recomendada em cada ponto, sem mais
perguntas, e deixar o subsistema pronto, testado e validado — mesmo precedente já
usado no subsistema 6 (Redação com correção por IA). As decisões abaixo seguem os
padrões dos 6 subsistemas anteriores (walking skeleton, reaproveitar infraestrutura
existente antes de criar nova, YAGNI) e pesquisa real sobre como os concorrentes
diretos monetizam hoje (Estuda.com, Descomplica, Stoodi — pesquisado em 2026-08-22,
ver seção "Pesquisa de mercado").

## Pesquisa de mercado

Todos os três concorrentes usam o mesmo modelo básico: cadastro grátis com acesso
limitado + assinatura recorrente (cartão, Pix ou boleto) para acesso completo.

- **Estuda.com** (o modelo citado como referência desde o início do projeto): plano
  "Treineiro" grátis já inclui banco de questões, 1 simulado completo e **créditos de
  redação limitados por mês** — não é um bloqueio total, é um limite de uso. Plano
  pago "Aprovado" (R$ 34,90/mês no anual) libera muito mais questões, simulados com
  nota TRI e relatório de desempenho.
- **Descomplica**: não tem camada grátis de verdade (é curso pago desde a entrada),
  mas o dado mais relevante para este projeto é que a correção de redação é vendida
  como **crédito mensal explícito — "20 correções de redação/mês"** — em todos os
  planos, inclusive no curso avulso de Redação (R$ 34,90/mês no anual). Esse número
  concreto (20/mês) é usado abaixo como a cota do plano pago daqui.
- **Stoodi**: cadastro grátis dá acesso a uma fração fixa do catálogo (aulas e
  exercícios "grátis" nomeados como tal) mais 7 dias de teste; plano anual pago
  (a partir de ~R$ 13,90/mês) libera o catálogo completo.

Conclusão aplicada ao design: o padrão ouro não é "tudo trancado atrás de paywall",
é **limite de uso no grátis, sem limite (ou limite alto) no pago**, com a correção de
redação sendo o recurso mais consistentemente tratado como um crédito contado — faz
sentido, é o único recurso deste produto com custo variável real por uso (chamada à
API da Claude). Este design segue o mesmo padrão.

## Objetivo

Introduzir um plano pago único ("Premium") via Stripe, com limites de uso no plano
grátis nos três recursos deste produto que têm valor de retenção ou custo real:
Prática por assunto, Simulados e Redação com correção por IA. Dashboard/recomendação
adaptativa **continua livre em ambos os planos** (ver "Fora de escopo").

## Escopo do MVP

- Um único plano pago recorrente mensal, sem níveis (sem "Aprovado vs Premium MED"
  dos concorrentes — YAGNI para uma assinatura só, pode virar múltiplos planos
  depois se o produto crescer). Preço: **R$ 29,90/mês**, dentro da faixa real dos
  três concorrentes pesquisados.
- Checkout via **Stripe Checkout hospedado** (não embutido/Elements) — mais simples
  de implementar e manter, sem exigir Stripe.js no cliente; a Stripe cuida de
  PCI compliance inteiramente fora do domínio do produto. Server cria a sessão,
  cliente é redirecionado.
- Gerenciamento de assinatura (cancelar, trocar cartão) via **Stripe Customer
  Portal** — mesma razão: reaproveita UI pronta e testada da própria Stripe em vez
  de construir uma tela de "minha assinatura" do zero.
- Sincronização de status via **webhook** (fonte da verdade sobre "o usuário X está
  ativo?" fica numa tabela própria, atualizada pela Stripe, não numa chamada síncrona
  à API da Stripe a cada request — é o padrão real de mercado para SaaS billing,
  confirmado na pesquisa técnica desta sessão).
- Sem trial gratuito automático, sem cupom/desconto, sem plano anual — tudo YAGNI
  para a primeira versão; o mecanismo de checkout já suporta adicionar isso depois
  sem redesenho.

## Limites do plano grátis (gating)

Cada limite reaproveita uma tabela que já existe — nenhuma tabela nova de contagem
é necessária, apenas `COUNT` sobre dados já gravados por cada subsistema:

- **Prática por assunto**: até **20 questões respondidas por dia** (conta linhas em
  `attempts` do usuário com `createdAt` no dia corrente, fuso do servidor). Acima
  disso, a rota de resposta retorna 402 com mensagem clara; a tela mostra um aviso e
  CTA para assinar. Plano Premium: sem limite.
- **Simulados**: até **1 simulado iniciado, para sempre**, no plano grátis (conta
  linhas em `simulados` do usuário, qualquer status). Plano Premium: sem limite.
  Escolhido "1 para sempre" em vez de "1 por mês" porque um simulado leva horas e é
  um evento raro — um limite mensal seria equivalente a "sem limite" na prática para
  a maioria dos alunos gratuitos, não cumpriria função de conversão.
- **Redação com correção por IA**: até **1 correção por mês** no plano grátis, até
  **20 correções por mês** no plano Premium (conta linhas em `redacoes` do usuário
  com `createdAt` no mês corrente — número do Premium vem direto da pesquisa de
  mercado, Descomplica usa exatamente "20/mês"). Este é o gate mais importante do
  ponto de vista de custo real: cada correção é uma chamada paga à API da Claude, e
  o subsistema 6 documentou explicitamente esse risco como pendente até este
  subsistema existir.

Todos os três limites são verificados por um único módulo central,
`lib/entitlements.ts`, para não espalhar lógica de negócio de billing em três rotas
diferentes (mesmo padrão de centralização já usado em `requireUser`/`requireAdmin`):

```ts
export type Plan = "free" | "premium";

export async function getUserPlan(userId: string): Promise<Plan>;
export async function canPracticeToday(userId: string): Promise<boolean>;
export async function canStartSimulado(userId: string): Promise<boolean>;
export async function canSubmitRedacao(userId: string): Promise<boolean>;
```

`getUserPlan` lê a tabela `subscriptions` (ver modelo de dados): "premium" se existir
uma linha com `status` em `("active", "trialing")` **e** `currentPeriodEnd` no
futuro; "free" em qualquer outro caso (sem linha, cancelada, atrasada, expirada).
As três funções de `can...` primeiro checam `getUserPlan` — premium sempre retorna
`true` sem contar nada, evitando uma query desnecessária no caminho mais comum de
usuário pagante.

## Fora de escopo (decisão explícita)

**Dashboard + recomendação adaptativa (subsistema 5) continua livre em ambos os
planos.** A Estuda.com trata "relatório de desempenho" como recurso pago — seria a
opção mais fiel ao concorrente citado como referência — mas essa tela já está no ar
sem nenhum gate desde 2026-08-20 e trancá-la agora seria uma regressão de
comportamento numa feature já publicada, sem pedido explícito do usuário para isso.
Decisão: manter grátis, porque a recomendação adaptativa é também o que direciona o
aluno de volta para Prática/Simulados/Redação — as três coisas que *estão* limitadas
— funcionando como funil de conversão em vez de produto pago em si. Pode ser
revisitado no futuro como um subsistema separado, não faz parte deste.

## Modelo de dados

Uma tabela nova em `db/schema.ts`, seguindo as convenções já usadas (`id:
text().primaryKey()`, `userId` com `onDelete: cascade`, índice na FK e no campo mais
consultado):

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

Os nomes dos valores de `status` espelham literalmente os status reais de uma
Stripe Subscription (`trialing`/`active`/`past_due`/`canceled`/`incomplete`) — evita
inventar um vocabulário paralelo que precisaria de tradução manual a cada webhook.
`userId` é `unique`: este produto tem um único plano, então um usuário tem no máximo
uma assinatura relevante por vez; se ele cancelar e assinar de novo depois, a linha
existente é atualizada (upsert por `stripeSubscriptionId` na prática, ver webhook).

## Integração com a Stripe

Novo `lib/stripe.ts`, mesmo padrão de inicialização preguiçosa de `lib/gemini.ts` e
`lib/anthropic.ts` (evita que o CI quebre por falta de chave):

```ts
import Stripe from "stripe";

let client: Stripe | undefined;

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

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` e `STRIPE_PRICE_ID_PREMIUM` **não**
entram no `envSchema` de `lib/env.ts` (mesma convenção de `GEMINI_API_KEY` e
`ANTHROPIC_API_KEY`: chaves de serviços externos de terceiros são lidas direto de
`process.env` no client preguiçoso, não fazem parte da validação estrita de
infraestrutura própria).

### Rotas de API

- `POST /api/stripe/checkout` — `requireUser`; cria uma Stripe Checkout Session
  (`mode: "subscription"`, `price: STRIPE_PRICE_ID_PREMIUM`, `success_url` para
  `/planos?sucesso=1`, `cancel_url` para `/planos`); se o usuário ainda não tem
  `stripeCustomerId` (nenhuma linha em `subscriptions`), deixa a própria Stripe criar
  o customer no checkout (`customer_email` pré-preenchido); retorna a URL da sessão,
  cliente faz `window.location.href` para lá (mesmo padrão de redirect explícito já
  usado no fluxo de login).
- `POST /api/stripe/portal` — `requireUser`; exige uma linha existente em
  `subscriptions` (400 se não existir — não faz sentido abrir portal sem nunca ter
  assinado); cria uma Customer Portal Session com `return_url` para `/planos`;
  retorna a URL, mesmo padrão de redirect.
- `POST /api/stripe/webhook` — **route handler puro, não pode ser Server Action**
  (webhooks são POSTs externos da própria Stripe, chegam sem contexto de sessão do
  Next.js). Verifica a assinatura do corpo bruto da requisição com
  `stripe.webhooks.constructEvent` e `STRIPE_WEBHOOK_SECRET` antes de processar
  qualquer coisa — requisição sem assinatura válida é rejeitada com 400 e nada é
  gravado. Eventos tratados:
  - `checkout.session.completed` — busca a subscription recém-criada na Stripe
    (`session.subscription`), faz upsert em `subscriptions` por `stripeSubscriptionId`.
  - `customer.subscription.updated` — upsert do status e `currentPeriodEnd` atuais
    (cobre renovação, upgrade, pagamento atrasado indo para `past_due`, etc.).
  - `customer.subscription.deleted` — atualiza `status` para `"canceled"` na linha
    existente (não deleta a linha — mantém histórico de que o usuário já foi
    assinante, útil para métricas e para não recriar o customer na Stripe à toa se
    ele assinar de novo).
  - Qualquer outro tipo de evento: 200 ignorado (a Stripe reenvia eventos não-2xx
    indefinidamente; responder 200 para tipos não tratados evita reentrega infinita).

Next.js App Router já desabilita o parsing automático de body em route handlers
(usa `request.text()` para o corpo bruto antes de qualquer `JSON.parse`), então não
é necessário nenhum config especial de "raw body" como seria em Pages Router —
confirmar isso durante a implementação, é um detalhe que already muda entre
versões do Next.js.

## Páginas

- `/planos` — página pública (não exige login para visualizar, mas o botão "Assinar"
  redireciona para `/entrar` se deslogado, mesmo padrão de proteção client-side já
  usado em Prática/Simulados/Redação). Mostra duas colunas: Grátis (lista os três
  limites acima) e Premium (R$ 29,90/mês, lista os três limites elevados/removidos).
  Se o usuário logado já é Premium, o card Premium mostra "Gerenciar assinatura"
  (chama `/api/stripe/portal`) em vez de "Assinar" (chama `/api/stripe/checkout`).
  Trata `?sucesso=1` na URL mostrando uma mensagem de confirmação pós-checkout (o
  webhook já deve ter processado antes do usuário retornar do Stripe Checkout na
  prática, mas a UI não bloqueia nisso — apenas mostra a mensagem, o estado real vem
  sempre de `subscriptions` no próximo carregamento de qualquer página).
- Link "Planos" no `Header.tsx`, visível para todos (logados ou não) — mesmo padrão
  de link direto já usado para "Praticar"/"Redação". Usuário Premium logado vê um
  badge discreto "Premium" ao lado do nome no header em vez do link "Planos" (sinaliza
  status sem precisar entrar na página).

## Aplicação dos limites nas rotas existentes

Três rotas já existentes ganham uma checagem adicional no início, depois de
`requireUser` e antes de qualquer efeito colateral:

- `POST /api/practice/attempts` (subsistema 3) — chama `canPracticeToday`; se
  `false`, responde 402 com `{error: "Limite diário do plano grátis atingido"}`.
- `POST /api/simulados` (subsistema 4, criação de simulado) — chama
  `canStartSimulado`; se `false`, responde 402 com mensagem equivalente. Simulados
  já em andamento (criados antes do limite ou enquanto ainda era o único do usuário)
  continuam acessíveis e finalizáveis normalmente — o gate é só na criação de um
  novo.
- `POST /api/redacao/redacoes` (subsistema 6) — chama `canSubmitRedacao` **antes**
  de chamar `gradeRedacao` (evita gastar a chamada paga à Claude se o usuário já
  está sem crédito); se `false`, responde 402 com mensagem equivalente.

Escolhido 402 Payment Required (não 403) porque é semanticamente o status HTTP
correto para "isso existe e você tem permissão de identidade, só falta pagar" — e
diferencia de um 403 de autorização real (ex.: tentar editar redação de outro
usuário), que já é usado em todo o resto do projeto com outro significado.

Cada uma das 3 páginas cliente correspondentes (`/pratica/[subject]/[topicId]`,
`/simulados`, `/redacao/[temaId]`) trata esse 402 mostrando um aviso com link para
`/planos`, em vez do erro genérico usado para outras falhas de rede.

## Testes

Segue exatamente o padrão do subsistema 6: `lib/entitlements.ts` é testado
integralmente contra o Postgres local real (sem mocks — é lógica pura de contagem
sobre tabelas já existentes, mesma convenção de zero-mock-para-banco usada em todo o
projeto), cobrindo grátis-dentro-do-limite, grátis-no-limite, grátis-acima-do-limite,
premium-sem-limite, premium-expirado-vira-free (checa `currentPeriodEnd` no
passado), sem-linha-em-subscriptions-vira-free.

Sem `STRIPE_SECRET_KEY` real disponível neste ambiente (mesma situação documentada
para `ANTHROPIC_API_KEY` no subsistema 6), os testes de `/api/stripe/checkout` e
`/api/stripe/portal` usam `vi.mock` sobre `lib/stripe.ts`. O teste do webhook **não**
precisa mockar a verificação de assinatura — a biblioteca `stripe` expõe
`stripe.webhooks.generateTestHeaderString`, que gera uma assinatura válida a partir
de um payload de teste e do `STRIPE_WEBHOOK_SECRET` (que pode ser qualquer string
fixa em ambiente de teste, não precisa ser real), permitindo testar o fluxo completo
de verificação + processamento de cada tipo de evento sem chave real da Stripe.

As três rotas com gate novo (`attempts`, `simulados`, `redacoes`) ganham um teste
cada cobrindo o 402 quando o limite está estourado, além dos testes já existentes.

## Erros e casos extremos

- Webhook com assinatura inválida: 400, nada processado (proteção contra requisições
  forjadas — qualquer um pode fazer POST para essa URL, só a assinatura garante que
  veio da Stripe de verdade).
- Webhook de um evento cujo `stripeSubscriptionId` não existe ainda em
  `subscriptions` (pode acontecer se `customer.subscription.updated` chegar antes de
  `checkout.session.completed` terminar de processar, ordem não é garantida pela
  Stripe): faz upsert normalmente (insere se não existir) em vez de assumir que a
  linha já existe — evita uma corrida perder um evento.
- Usuário tenta abrir o portal sem nunca ter assinado: 400 com mensagem clara,
  botão "Gerenciar assinatura" nem aparece nesse caso na prática (só aparece quando
  `getUserPlan` já indica premium), mas a rota valida mesmo assim como defesa.
- `currentPeriodEnd` no passado mas `status` ainda `"active"` (pode acontecer por
  atraso entre o fim do período e o webhook de renovação chegar): tratado como free
  até o próximo webhook corrigir — é a mesma filosofia de "banco de dados próprio é
  a fonte da verdade, mas está sempre um passo atrás da Stripe por definição", e o
  atraso típico é de segundos a minutos, não dias.

## Risco conhecido, não resolvido nesta versão

Nenhum teste de carga foi feito sobre o volume de webhooks — para o volume atual do
produto (poucos usuários, pré-lançamento monetizado) isso não é um risco real, mas
se o produto crescer rápido depois de ativo, vale revisitar se a rota de webhook
precisa de alguma proteção adicional contra reentrega em rajada da própria Stripe
(ela reenvia em backoff exponencial se não receber 2xx a tempo).

## Bloqueio externo conhecido

Este ambiente não tem uma conta Stripe real nem chaves reais (`STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PREMIUM`) disponíveis. O código será
implementado, testado (com mocks e com `generateTestHeaderString` para o webhook) e
revisado por completo, mas o checkout real só vai funcionar depois que:

1. Uma conta Stripe for criada (ou a existente do usuário, se houver) e colocada em
   modo teste primeiro.
2. Um Product + Price recorrente mensal de R$ 29,90 for criado no dashboard da
   Stripe, gerando o `STRIPE_PRICE_ID_PREMIUM`.
3. Um endpoint de webhook for registrado no dashboard da Stripe apontando para
   `https://plataforma-enem-rose.vercel.app/api/stripe/webhook`, gerando o
   `STRIPE_WEBHOOK_SECRET` correspondente.
4. As três variáveis forem adicionadas em `.env.local` (dev) e nas variáveis de
   ambiente do Vercel (produção) — mesmo lugar onde `DATABASE_URL` etc. já estão
   hoje.
5. Depois de validado em modo teste (cartão de teste `4242 4242 4242 4242` da
   própria Stripe), repetir os passos 2-4 em modo produção (live) antes de cobrar
   de um usuário real.

Este é o único conjunto de passos manuais que não pode ser feito de forma autônoma
— mesma natureza do bloqueio de `ANTHROPIC_API_KEY` documentado no subsistema 6.
