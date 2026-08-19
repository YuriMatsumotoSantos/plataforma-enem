# Simulados — design

**Status:** aprovado, pronto para plano de implementação.
**Subsistema:** 4 de 7 (ver `docs/superpowers/specs/2026-08-13-plataforma-enem-design.md` para o roadmap completo).

## Objetivo

Prova completa no formato real do ENEM (2 dias, 90 questões por dia, 45+45 por área), em dois modos que o aluno escolhe:

- **Mesclado** — 45 questões de cada área do dia, sorteadas entre todos os anos disponíveis no banco, balanceadas por tópico.
- **Fiel** — as mesmas 90 questões de um dia real e específico de um ano real do ENEM, na ordem original da prova.

Cada simulado cobre **um dia** (1 ou 2), não os dois juntos — o aluno escolhe dia 1, dia 2, ou ambos em sessões separadas, do jeito que quiser espaçar o treino.

## Restrição de dados atual

Hoje (2026-08-19) só existe o ano 2025 no banco, e nenhuma área/dia tem aprovadas suficientes: dia 1 tem 29/90 aprovadas, dia 2 tem 42/90. Isso significa que, no lançamento, tanto o modo fiel quanto o mesclado provavelmente aparecerão bloqueados até a curadoria avançar. Isso é aceito — o sistema deve se autodestravar conforme mais questões forem aprovadas, sem precisar de mudança de código.

## Modelo de dados

Uma tabela nova, `simulados`, guarda o exame inteiro como snapshot (sem tabela relacional por questão — nada no produto precisa consultar respostas de uma questão específica entre simulados diferentes; a tela do simulado sempre lê/escreve o pacote inteiro de uma vez):

```ts
export const simuladoMode = pgEnum("simulado_mode", ["mesclado", "fiel"]);
export const simuladoStatus = pgEnum("simulado_status", ["em_andamento", "finalizado"]);

export const simulados = pgTable("simulados", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  mode: simuladoMode("mode").notNull(),
  examDay: integer("exam_day").notNull(),        // 1 ou 2 — mesmo conceito de questions.examDay
  examYear: integer("exam_year"),                 // só setado quando mode = 'fiel'
  status: simuladoStatus("status").default("em_andamento").notNull(),
  questionIds: jsonb("question_ids").$type<string[]>().notNull(),   // ordem fixa das 90, congelada na criação
  answers: jsonb("answers").$type<Record<string, { selectedAnswer: string | null; markedForReview: boolean }>>()
    .notNull().default({}),
  durationSeconds: integer("duration_seconds").notNull(),  // snapshot da duração oficial na criação
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
});
```

Índice em `userId` (listar histórico) e em `status` (achar `em_andamento` do usuário).

`durationSeconds` é fixo em código por dia (dia 1 = 5h30 / 19800s, dia 2 = 5h / 18000s — durações oficiais do ENEM) e apenas copiado para a linha na criação, para que mudar a constante no futuro não altere um simulado já em andamento.

## Seleção de questões

**Fiel:** todas as aprovadas de `year` + `examDay` exatos, ordenadas por `questionNumber` (ordem real da prova). Só oferecido quando esse par year+day tem exatamente 90 aprovadas.

**Mesclado:** para cada uma das 2 áreas do dia escolhido (dia 1 → linguagens + humanas, dia 2 → natureza + matemática):
1. Busca aprovadas daquela área, agrupadas por `topicId`.
2. Sorteia em round-robin entre os tópicos (uma questão aleatória de cada tópico por vez, ciclando) até fechar 45 — espalha por assunto em vez de vir tudo do mesmo tópico, sem exigir contagem igual por tópico.
3. Intercala as 45 de cada área na ordem final (não importa a ordem exata, só que as duas áreas apareçam).

Só oferecido quando **cada** área do dia tem `>= 45` aprovadas somando todos os anos.

**Questões anuladas (`correctAnswer = 'Anulado'`):** excluídas do pool candidato no modo mesclado (mesmo tratamento da Prática por assunto — não faz sentido sortear uma questão sem gabarito certo). No modo fiel elas **são incluídas** quando fazem parte do dia real (fidelidade à prova original), mas ficam de fora do denominador da nota — ver seção de nota por área.

## Disponibilidade

`GET /api/simulados/available` retorna, para cada opção (fiel por year+day existente, mesclado por dia 1/dia 2):
- `disponivel: boolean`
- progresso atual (ex: fiel `{aprovadas: 71, necessarias: 90}`; mesclado `{areas: [{area, aprovadas, necessarias: 45}, ...]}`)

A tela `/simulados` mostra as opções bloqueadas também, com o progresso, em vez de escondê-las — dá visibilidade do que falta pra curadoria destravar.

## Fluxo de telas

- **`/simulados`** — cards de Fiel (por ano/dia) e Mesclado (dia 1 / dia 2), com progresso quando bloqueado; link para histórico.
- **`/simulados/[id]`** — tela da prova:
  - Grade 1–90 sempre visível: respondida / em branco / marcada-pra-revisar (navegação livre, clique pula direto pra qualquer questão).
  - Painel com a questão atual (enunciado, alternativas, imagem se houver).
  - Botão "Marcar pra revisar" na questão atual.
  - Cronômetro regressivo a partir de `durationSeconds`, contado desde `startedAt`; **sem auto-submit** — pode passar de zero, mostra tempo negativo/excedido.
  - Sem feedback certo/errado durante a prova (só ao finalizar).
  - Botão "Finalizar simulado" (confirma se houver questões em branco).
  - Cada clique em alternativa ou em "marcar" dispara `PATCH` imediato (autosave) — sem botão salvar.
- **Retomada:** abrir `/simulados/[id]` de um `em_andamento` existente recarrega `questionIds`/`answers` do banco e recalcula o tempo restante a partir de `startedAt`; nenhum estado novo é criado no cliente.
- **`/simulados/[id]/resultado`** (só acessível se `status = finalizado`):
  - Nota bruta por área (ex: "32/45 em Linguagens", "28/45 em Humanas"). Questões anuladas (possíveis no modo fiel) não contam nem como certo nem como errado — saem do denominador (ex: "32/44" se 1 das 45 for anulada).
  - Revisão completa: lista das 90 questões com enunciado, alternativas, resposta do aluno vs correta marcadas.
- **`/simulados/historico`** — lista dos simulados do usuário (data, modo, ano/dia, nota resumida se finalizado, botão "Continuar" se `em_andamento`).

## API

| Rota | Descrição |
|---|---|
| `GET /api/simulados/available` | Disponibilidade + progresso de cada opção fiel/mesclado |
| `POST /api/simulados` | `{mode, examDay, examYear?}` → monta snapshot, cria linha, retorna `id` |
| `GET /api/simulados/:id` | Pacote completo (metadados + 90 questões com conteúdo + respostas atuais) |
| `PATCH /api/simulados/:id/respostas` | `{questionId, selectedAnswer?, markedForReview?}` — merge no jsonb `answers` |
| `POST /api/simulados/:id/finalizar` | Marca `finalizado`, `finishedAt = now`, grava `attempts` das questões respondidas |
| `GET /api/simulados/:id/resultado` | Nota por área + payload de revisão (403 se não `finalizado`) |
| `GET /api/simulados` | Histórico do usuário |

Todas exigem sessão autenticada (`requireUser`, já existente); `:id` só acessível pelo `userId` dono.

## Integração com `attempts`

Ao finalizar, insere um `attempts` por questão **respondida** (pula as em branco — a tabela representa "resposta dada", não "questão vista", mesmo padrão da Prática por assunto). Garante que um futuro dashboard (subsistema 5) leia uma fonte única de histórico, sem precisar saber se a resposta veio da Prática ou de um Simulado.

## Retentativa

Refazer um simulado (mesmo modo/dia/ano) cria uma **nova linha** em `simulados` com um snapshot recalculado no momento — no fiel, as mesmas 90 questões (por ID, mas com conteúdo lido ao vivo da tabela `questions`, então se a curadoria editar o texto entretanto, a nova tentativa reflete a versão atual); no mesclado, um sorteio novo. Sem limite de tentativas.

## Fora de escopo

- **TRI**: nota é contagem bruta de acertos por área, não a escala oficial do ENEM (exigiria parâmetros de item que a plataforma não tem).
- **Redação**: pertence ao subsistema 6, não faz parte do simulado.
- **Auto-submit ao zerar o cronômetro**: o timer é só informativo.
- **Questão excluída/rejeitada durante um simulado em andamento**: não há hard-delete de questão no produto hoje, risco aceito sem tratamento especial.
- **Sessão única cobrindo os 2 dias**: cada simulado é de um dia só; o aluno decide como espaçar os dois.
