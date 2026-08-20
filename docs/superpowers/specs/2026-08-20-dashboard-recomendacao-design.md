# Dashboard + recomendação adaptativa — design

**Status:** aprovado, pronto para plano de implementação.
**Subsistema:** 5 de 7 (ver `docs/superpowers/specs/2026-08-13-plataforma-enem-design.md` para o roadmap completo).

## Objetivo

Ler o histórico já gravado em `attempts` (escrito por Prática por assunto e por Simulados, subsistemas 3 e 4) e transformar isso em orientação de estudo: quais assuntos estão vencidos para revisão, quais são pontos fracos, e uma sessão de prática pronta que intercala vários desses assuntos numa sessão só. Este subsistema só lê `attempts`/`questions`/`topics` — nenhuma mudança nas tabelas ou rotas dos subsistemas 3 e 4.

## Modelo de dados

Uma tabela nova, `topic_progress`, um registro por (usuário, assunto), guardando o estado FSRS (repetição espaçada) daquele assunto para aquele aluno:

```ts
export const topicProgress = pgTable(
  "topic_progress",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    topicId: text("topic_id").notNull().references(() => topics.id),
    stability: real("stability").notNull(),
    difficulty: real("difficulty").notNull(),
    state: integer("state").notNull().default(0),   // ts-fsrs State enum: New/Learning/Review/Relearning
    lapses: integer("lapses").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    dueAt: timestamp("due_at").notNull(),
    lastReviewedAt: timestamp("last_reviewed_at").notNull(),
  },
  (table) => [
    unique("topic_progress_user_topic_unique").on(table.userId, table.topicId),
    index("topic_progress_user_idx").on(table.userId),
    index("topic_progress_due_idx").on(table.dueAt),
  ]
);
```

Sem linha para um `(userId, topicId)` = assunto nunca revisado ("não iniciado"), categoria separada de "vencido" e "fraco". `stability`/`difficulty`/`state`/`lapses`/`reps` são exatamente os campos que a biblioteca `ts-fsrs` precisa receber e devolver a cada recálculo, para reconstruir o "card" anterior sem perder fidelidade ao algoritmo.

## Granularidade: por assunto, não por questão

FSRS clássico (estilo Anki) agenda revisão por card individual. Aqui a unidade é o **assunto** (`topicId`), não a questão, por três motivos estruturais que não dependem do tamanho do banco de questões:

1. A prática já é organizada por assunto (`/pratica/[subject]/[topicId]` = todas as aprovadas daquele tópico, embaralhadas) — FSRS por assunto reaproveita esse fluxo sem mudar nada nele.
2. Intercalação (misturar assuntos numa sessão) já pensa em unidade de assunto — FSRS por questão exigiria agregar de volta pra assunto de qualquer jeito.
3. Uma linha por (usuário, assunto) escala muito melhor que uma linha por (usuário, questão) conforme o banco de questões e a base de usuários crescem.

## Motor de recálculo FSRS (sob demanda)

Função central `getOrUpdateTopicProgress(userId, topicId)`, chamada sempre que o dashboard ou a sessão recomendada precisam do estado atual de um assunto. Sem job de fundo — roda dentro da própria requisição, mesmo padrão síncrono já usado em todo o resto do projeto:

1. Busca a linha existente em `topic_progress` (se não existir, é a primeira revisão).
2. Busca `attempts` daquele `topicId` (join `attempts.questionId → questions.topicId`) daquele usuário, com `createdAt > lastReviewedAt` (ou todas, se é a primeira vez).
3. Sem tentativas novas → retorna o estado como está, nada muda.
4. Com tentativas novas → calcula `% de acerto` do lote e converte em nota FSRS:
   - 100% → Easy (4)
   - ≥ 70% → Good (3)
   - ≥ 40% → Hard (2)
   - < 40% → Again (1)
5. Chama `ts-fsrs`'s `next(cardAtual, now, nota)`, pega o novo estado.
6. Upsert em `topic_progress` com `lastReviewedAt = now` (o instante do próprio recálculo, não o `createdAt` de nenhuma tentativa) — como tanto a atualização quanto a checagem de "vencido" só acontecem de forma preguiçosa, no carregamento do dashboard/sessão recomendada, usar o mesmo relógio para as duas coisas mantém o sistema internamente consistente mesmo sem refletir com precisão o instante exato de cada resposta.

**Guarda de concorrência:** o `UPDATE` inclui `WHERE last_reviewed_at = $valorLidoAntes`; se zero linhas forem afetadas (outra requisição já processou esse lote — ex: duas abas abertas), a requisição descarta seu resultado sem re-aplicar. Mesmo padrão de guarda atômica já usado no `finalizar` de Simulados (subsistema 4).

**"Vencido"** = `topic_progress.dueAt <= now`.

**"Ponto fraco"** = `topic_progress.difficulty >= 6` (escala do `ts-fsrs` vai de 1 a 10) — reusa o parâmetro que o próprio FSRS já calcula, em vez de uma métrica de acerto/erro paralela que poderia divergir. Um assunto pode ser vencido e fraco ao mesmo tempo. Assuntos nunca revisados (sem linha em `topic_progress`) não contam como fracos.

## Sessão recomendada (`/pratica/recomendada`)

`GET /api/practice/recommended` monta a lista de assuntos da sessão:

1. Roda o recálculo acima para manter `topic_progress` atualizado.
2. Pega até 5 assuntos vencidos, mais atrasados primeiro (`dueAt` crescente).
3. Se sobrar vaga, completa com os assuntos mais fracos (`difficulty` decrescente) ainda não incluídos.
4. Se ainda sobrar vaga — inclusive para um aluno sem nenhuma linha em `topic_progress` — completa com assuntos nunca praticados, escolhidos aleatoriamente entre os que têm ao menos 1 questão aprovada. A recomendação sempre entrega algo, mesmo para aluno novo.
5. Busca todas as questões aprovadas e não-"Anulado" desses até-5 assuntos, junta num pool único, embaralha uma vez (mesma `shuffle()` de `/pratica`).

A página `/pratica/recomendada` reaproveita o mesmo componente de pergunta/resposta/feedback de `/pratica/[subject]/[topicId]` — muda só a origem do pool. Cada resposta grava em `attempts` normalmente pelo `POST /api/practice/attempts` já existente (mesmo formato, sem mudança), então o próximo carregamento do dashboard já enxerga essas tentativas no próximo recálculo.

## Página `/dashboard`

- **Card "Sessão recomendada"** — CTA fixo para `/pratica/recomendada`, sempre disponível.
- **Lista "Assuntos vencidos"** — cards com nome do assunto + matéria, cada um linkando para `/pratica/[subject]/[topicId]`. Vazia = "nenhum assunto vencido agora", estado normal, não erro.
- **Lista "Pontos fracos"** — mesmo formato, filtrado por `difficulty >= 6`.
- **Nav** — link "Dashboard" em `Header.tsx` (logado), ao lado do "Praticar" já existente.

`GET /api/dashboard` roda o recálculo e devolve as duas listas prontas num único payload (sem N+1 por assunto).

## API

| Rota | Descrição |
|---|---|
| `GET /api/dashboard` | Recalcula `topic_progress` pendente e retorna listas de vencidos + fracos |
| `GET /api/practice/recommended` | Monta a lista de até 5 assuntos (vencidos → fracos → nunca-praticados) e o pool de questões embaralhado |

Ambas exigem sessão autenticada (`requireUser`, já existente). `/pratica/recomendada` reusa `POST /api/practice/attempts` já existente para gravar respostas — nenhuma rota nova de escrita.

## Dependência nova

`ts-fsrs` (npm) — implementação de referência do algoritmo FSRS em TypeScript. Cobre a matemática real (estabilidade, dificuldade, curva de esquecimento) que seria arriscado reimplementar à mão; nenhuma outra dependência já instalada resolve isso.

## Fora de escopo

- **Blocked vs. interleaved como escolha explícita do aluno**: o design entrega intercalado (sessão recomendada) e blocked (prática por assunto normal) como dois fluxos que já existem lado a lado — não há um toggle ou configuração explícita "modo de estudo", o aluno escolhe implicitamente pela tela que acessa.
- **Gráficos de tendência / estatísticas gerais** (% de acerto agregado, cobertura de assuntos): MVP mínimo é vencidos + fracos + CTA, seguindo o padrão de walking-skeleton dos subsistemas anteriores. Pode virar uma extensão futura da mesma página.
- **Ajuste de parâmetros do FSRS por aluno** (ex: "retenção desejada" configurável): usa os parâmetros default do `ts-fsrs`.
- **Peso diferenciado por dificuldade da questão em si** (uma questão mais difícil do que outra do mesmo assunto): a nota FSRS é sempre derivada do % de acerto agregado do lote, sem diferenciar questões individuais.
- **Questão excluída/rejeitada afetando `topic_progress` retroativamente**: sem tratamento especial, mesmo risco aceito documentado em Simulados.
- **O agendamento do FSRS depende de quando o aluno abre o dashboard, não só de quando ele responde**: como o lote de "tentativas novas" é definido por `lastReviewedAt` (o instante do último recálculo, não de cada resposta individual), duas rodadas de estudo separadas por uma visita ao dashboard entre elas geram duas revisões FSRS distintas, enquanto as mesmas respostas sem visitar o dashboard no meio geram uma revisão só. Aceito como consequência do desenho preguiçoso/sob-demanda (sem job em background), não corrigido nesta versão.
