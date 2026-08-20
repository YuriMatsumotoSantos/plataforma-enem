# Redação com correção por IA — design

Status: aprovado (decisões tomadas autonomamente pelo usuário, ver nota de processo abaixo).

## Nota de processo

Esta spec foi escrita sem o ciclo normal de perguntas do `/superpowers:brainstorming`
porque o usuário pediu explicitamente, ao encerrar a sessão, para eu decidir tudo o
que fosse preciso decidir usando a opção mais recomendada em cada ponto, sem mais
perguntas, e deixar o subsistema pronto, testado e validado. As decisões abaixo
foram tomadas seguindo os padrões já estabelecidos nos 5 subsistemas anteriores
(walking skeleton, sem gating de freemium, sem infraestrutura nova além do
necessário) e a rubrica oficial do ENEM (informação pública do INEP).

## Objetivo

Aluno escolhe um tema de redação, escreve o texto, e recebe uma correção por IA
nas 5 competências oficiais do ENEM, cada uma de 0 a 200 pontos (múltiplos de 40),
nota total de 0 a 1000, com justificativa por competência.

## Escopo do MVP

- Banco de temas: poucos temas reais de provas passadas do ENEM (títulos oficiais,
  informação pública do INEP — mesma base legal já usada pelo banco de questões),
  inseridos via script de seed único, sem pipeline de extração nem UI de
  administração (YAGNI: são poucos registros, ao contrário das 180 questões que
  justificaram uma pipeline).
- Aluno escreve o texto em uma textarea (sem simulação de folha pautada/contagem
  de linhas do papel real — validação é por contagem de palavras).
- Correção é síncrona: a rota POST chama a API da Claude e só responde quando a
  nota sai. Não existe fila/job em background neste projeto hoje, e não é
  necessário criar uma para o walking skeleton (mesma lógica aplicada em Prática
  por assunto e Simulados: infra nova só quando o KPI pedir).
- Sem gating de freemium (subsistema 7 ainda não existe, mesmo precedente das
  duas features anteriores).
- Sem correção de rascunho automática, sem histórico de revisões do mesmo texto.

## Modelo de dados

Duas tabelas novas em `db/schema.ts`, seguindo as convenções já usadas
(`id: text().primaryKey()`, `userId` com `onDelete: cascade`, índices nas FKs
mais consultadas):

```ts
export const temas = pgTable("temas", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Tema = typeof temas.$inferSelect;

export type RedacaoScores = {
  competencia1: number;
  competencia2: number;
  competencia3: number;
  competencia4: number;
  competencia5: number;
};

export type RedacaoFeedback = {
  justificativas: string[]; // 5 posições, uma por competência
  comentarioGeral: string;
};

export const redacoes = pgTable(
  "redacoes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    temaId: text("tema_id")
      .notNull()
      .references(() => temas.id),
    text: text("text").notNull(),
    scores: jsonb("scores").$type<RedacaoScores>().notNull(),
    notaTotal: integer("nota_total").notNull(),
    feedback: jsonb("feedback").$type<RedacaoFeedback>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("redacoes_userId_idx").on(table.userId),
    index("redacoes_temaId_idx").on(table.temaId),
  ]
);

export type Redacao = typeof redacoes.$inferSelect;
```

Não há coluna de `status`: como a gravação só acontece depois da IA responder
com sucesso, toda linha em `redacoes` já representa uma correção completa. Se a
chamada à IA falhar, nada é persistido (ver seção de erros).

## Rubrica das 5 competências

Critérios oficiais do ENEM (informação pública do INEP), usados como instrução
de sistema para a IA:

1. Domínio da modalidade escrita formal da língua portuguesa.
2. Compreender a proposta e aplicar conceitos das várias áreas de conhecimento
   para desenvolver o tema, dentro da estrutura do texto dissertativo-argumentativo.
3. Selecionar, relacionar, organizar e interpretar informações, fatos, opiniões
   e argumentos em defesa de um ponto de vista.
4. Conhecimento dos mecanismos linguísticos necessários para a construção da
   argumentação.
5. Elaborar proposta de intervenção para o problema abordado, respeitando os
   direitos humanos.

Cada competência é pontuada em 6 níveis discretos: 0, 40, 80, 120, 160, 200.

## Integração com a API da Claude

Novo `lib/anthropic.ts`, espelhando o padrão de inicialização preguiçosa já
usado em `lib/gemini.ts` (evita que o CI quebre por falta de chave):

```ts
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY não definida (verifique .env.local)");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export const ANTHROPIC_MODEL = "claude-sonnet-5";
```

Novo `lib/redacao.ts` com `gradeRedacao(temaTitle: string, text: string)`:
monta o prompt com a rubrica acima, chama a Claude com `tool_choice` forçando
uma tool `submit_grade` cujo JSON schema exige as 5 notas (enum de
0/40/80/120/160/200 cada) e uma justificativa por competência mais um
comentário geral. Isso é o padrão "structured output via tool use" — evita
parsing frágil de texto livre. Como defesa extra e barata, a função clampa
qualquer nota fora dos 6 valores válidos para o valor permitido mais próximo
antes de somar `notaTotal`, para não persistir dado fora da rubrica caso o
modelo desvie do schema.

`ANTHROPIC_API_KEY` **não** entra no `envSchema` de `lib/env.ts` (mesma
convenção do `GEMINI_API_KEY`: chaves de IA são lidas direto de
`process.env` no client preguiçoso, não fazem parte da validação estrita de
variáveis de infraestrutura).

## Validação de entrada

- Mínimo de 50 palavras no texto (evita gastar uma chamada de API com
  submissões vazias/triviais). Validado no cliente (feedback imediato) e no
  servidor (fonte da verdade).
- Máximo de 3000 caracteres (folga generosa acima do que cabe numa redação
  real de 30 linhas, só para evitar abuso).

## Rotas de API

Seguindo exatamente os padrões já estabelecidos (`requireUser`, paginação
`page`/`pageSize`/`total`):

- `GET /api/redacao/temas` — lista todos os temas (id, title).
- `POST /api/redacao/redacoes` — body `{temaId, text}`. Valida usuário, tema e
  tamanho do texto; chama `gradeRedacao`; persiste; retorna a redação completa
  com notas e feedback. Se a chamada à IA falhar (rede, rate limit, timeout),
  responde 502 sem persistir nada — cliente mostra erro com opção de tentar de
  novo.
- `GET /api/redacao/redacoes` — histórico do usuário autenticado, paginado
  (`PAGE_SIZE = 20`, mesmo valor usado em `/admin/revisao`), mais recentes
  primeiro.
- `GET /api/redacao/redacoes/[id]` — detalhe de uma redação; 404 se não
  existir ou não pertencer ao usuário autenticado (nunca vazar redação de
  outro aluno).

## Páginas

- `/redacao` — lista de temas disponíveis, cada um com botão "Escrever", mais
  um link para `/redacao/historico`.
- `/redacao/[temaId]` — textarea com contador de palavras ao vivo, botão
  "Enviar para correção" desabilitado abaixo do mínimo, estado de
  carregamento explícito durante a chamada síncrona (pode levar alguns
  segundos).
- `/redacao/resultado/[id]` — nota total em destaque, card por competência
  (nota + justificativa), comentário geral.
- `/redacao/historico` — lista paginada de redações passadas (tema, nota
  total, data), cada uma linkando para sua página de resultado.

Novo link "Redação" no `Header.tsx` (logado apenas), mesmo padrão do link
"Praticar" — aprendizado documentado do subsistema 3, onde a feature ficou
sem entrada de navegação até a revisão final.

## Seed de temas

`scripts/seed-temas.ts`, rodado uma vez via
`npx tsx --env-file=.env.local scripts/seed-temas.ts` (mesmo padrão de
invocação do `npm run ingest`). Insere 5 temas reais de provas passadas do
ENEM (só o título oficial da proposta, informação pública do INEP):

1. "Desafios para a valorização de comunidades e povos tradicionais no Brasil" (2023)
2. "Desafios para o enfrentamento da invisibilidade do trabalho de cuidado realizado pela mulher no Brasil" (2022)
3. "Invisibilidade e registro civil: garantia de acesso à cidadania no Brasil" (2021)
4. "Democratização do acesso ao cinema no Brasil" (2019)
5. "Manipulação do comportamento do usuário pelo controle de dados na internet" (2018)

O script é idempotente (usa o título como chave de deduplicação antes de
inserir) para poder ser rodado de novo sem duplicar linhas.

## Testes

Sem `ANTHROPIC_API_KEY` real disponível neste ambiente, os testes de rota
usam `vi.mock` sobre `lib/anthropic.ts` para simular `getAnthropicClient()` e
verificar: validação de tamanho mínimo/máximo, clamping de notas fora da
rubrica, persistência correta, resposta 502 sem persistência quando a IA
falha, 401 sem sessão, 404 ao acessar redação de outro usuário. Isso testa
toda a lógica de negócio sem depender de uma chave real — a chamada real à
API só precisa ser verificada manualmente uma vez, com uma chave de verdade,
antes de considerar a feature validada em produção.

## Erros e casos extremos

- Texto vazio ou abaixo do mínimo: 400, mensagem clara.
- Tema inexistente: 400.
- Falha na chamada à IA (rede, rate limit, resposta fora do schema mesmo após
  tool use forçado): 502, nada persistido, cliente oferece tentar de novo.
- Acesso a `/redacao/resultado/[id]` de outro usuário: 404 (não 403, mesmo
  padrão de não vazar existência de recursos de outros usuários já usado no
  resto do projeto).

## Risco conhecido, não resolvido nesta versão

Cada correção custa uma chamada real à API da Claude (custo de tokens). Sem
subsistema de monetização (subsistema 7) ainda implementado, não há limite de
quantas redações um aluno pode enviar por dia. Mesmo precedente de Prática
por assunto e Simulados (não antecipar gating antes da hora) — mas aqui o
custo por uso é maior que o de servir uma pergunta do banco local, então isso
é um risco real a monitorar, não apenas um detalhe cosmético. Documentado
aqui para retomar quando o subsistema 7 for desenhado.

## Bloqueio externo conhecido

Este ambiente não tem uma `ANTHROPIC_API_KEY` real disponível. O código será
implementado, testado (com mocks) e revisado por completo, mas a correção
via IA só vai funcionar de fato depois que uma chave real for adicionada em
`.env.local` (dev) e nas variáveis de ambiente do Vercel (produção) — mesmo
lugar onde `DATABASE_URL`, `BETTER_AUTH_SECRET` etc. já estão configuradas
hoje. Este é o único passo manual que não pode ser feito de forma autônoma.
