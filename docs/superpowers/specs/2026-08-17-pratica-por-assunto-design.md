# Prática por assunto — Design

**Data:** 2026-08-17
**Status:** Aprovado para planejamento de implementação

## Contexto e motivação

Subsistema 3 do plano de 7 da Plataforma ENEM. Com o banco de questões curado (subsistema 2) e login/cadastro funcionando (subsistema 2.5), este é o primeiro fluxo real voltado ao aluno: escolher um assunto e praticar questões reais do ENEM sobre ele, uma de cada vez, com feedback imediato.

Este é deliberadamente um **walking skeleton**: o loop mais simples possível de "escolher assunto → responder → ver resultado", sem nenhuma lógica adaptativa. Repetição espaçada (FSRS), modos intercalado/bloqueado e recomendação de assuntos fracos pertencem ao subsistema 5 (Dashboard + recomendação adaptativa), que ainda não existe. Este subsistema grava dados (tentativas) que o subsistema 5 vai consumir depois, mas não lê nem usa esses dados agora.

## Escopo

- Duas telas de navegação (matéria → assunto) mostrando contagem de questões disponíveis em cada nível, seguidas de uma terceira tela onde a prática de fato acontece.
- Sessão de prática: todas as questões `status='aprovada'` e `correctAnswer != 'Anulado'` do assunto escolhido, uma por vez, em ordem embaralhada.
- Feedback imediato por questão (certo/errado, resposta correta revelada) e resumo ao final da sessão.
- Toda tentativa de resposta é persistida no banco (nova tabela `attempts`), para uso futuro do subsistema 5 — sem leitura própria desses dados neste subsistema.
- Exige apenas estar logado (qualquer `role`), sem gate de plano/freemium.

Fora de escopo (decisões adiadas, não bloqueiam este subsistema):
- Qualquer lógica de repetição espaçada, intercalação, ou priorização de assunto — subsistema 5.
- Retomar uma sessão interrompida — fechar a aba/navegar pra fora e voltar ao mesmo assunto sempre começa uma sessão nova, reembaralhada. Já existe uma linha por tentativa respondida no banco, mas nada usa isso para retomar.
- Explicação/resolução da resposta — a tabela `questions` não tem esse campo hoje; o feedback é limitado a certo/errado + revelar a letra correta.
- Gate de freemium (assinatura paga) — adiado para o subsistema 7 (Monetização).
- Qualquer tela de estatísticas/histórico de desempenho do aluno — isso é o Dashboard (subsistema 5).

## Arquitetura

Segue o padrão já estabelecido no projeto: Client Components consumindo rotas de API novas via `fetch`, mesmo estilo usado em `/admin/revisao`. Nenhuma Server Component.

### Modelo de dados

Nova tabela `attempts` em `db/schema.ts`:

```
attempts
  id            text primary key
  questionId    text not null, references questions(id)
  userId        text not null, references user(id)
  selectedAnswer text not null  -- letra escolhida pelo aluno (A-E)
  isCorrect     boolean not null
  createdAt     timestamp default now() not null
```

Sem `sessionId` ou qualquer conceito de "sessão" persistida — a sessão de prática vive inteiramente no estado do componente React do lado do cliente (índice da questão atual, ordem embaralhada, pontuação corrente). Isso é intencional e consistente com a decisão de não haver retomada: não existe estado de sessão no servidor para retomar.

`isCorrect` é sempre calculado no servidor, comparando `selectedAnswer` contra `questions.correctAnswer` — nunca confiado do que o cliente envia.

### Rotas de API

Todas exigem sessão autenticada (qualquer `role`). Novo helper `requireUser(request)` em `lib/session.ts`, espelhando o `requireAdmin` já existente em `lib/admin.ts`, mas sem checar `role`. Substitui o check de sessão hoje duplicado inline em `/api/me`.

- **`GET /api/practice/subjects`** → `{ subjects: [{ subject, area, count }] }`. Agrupa `topics.subject` (via join com `questions` filtrando `status='aprovada' AND correctAnswer != 'Anulado'`), contando questões disponíveis por matéria. Matérias com `count=0` não aparecem na lista.

- **`GET /api/practice/topics?subject=X`** → `{ topics: [{ id, name, count }] }`. Mesma filtragem, agrupada por `topics.id/name` dentro da matéria informada. `subject` inválido/sem resultados → lista vazia, não erro.

- **`GET /api/practice/questions?topicId=X`** → `{ questions: [{ id, year, examDay, questionNumber, statement, alternatives, imageUrl, topic }] }`. Todas as questões aprovadas e não-anuladas daquele `topicId`. **Importante: o campo `correctAnswer` nunca é incluído nesta resposta** — evita que o gabarito fique visível no Network tab do navegador antes do aluno responder. Alternativas vêm na ordem original (não embaralhadas no servidor); o embaralhamento da ordem das *questões* (não das alternativas) acontece no cliente.

- **`POST /api/practice/attempts`** → body `{ questionId, selectedAnswer }`. Busca a questão no servidor, calcula `isCorrect`, grava a linha em `attempts`, responde `{ isCorrect, correctAnswer }`. É essa resposta que a tela usa para pintar a alternativa de verde/vermelho e revelar a correta.

### Componentes / telas

**`app/pratica/page.tsx`** (novo) — Client Component. Busca `GET /api/practice/subjects` e lista as matérias com contagem, cada uma linkando para `/pratica/[subject]`.

**`app/pratica/[subject]/page.tsx`** (novo) — Client Component. Busca `GET /api/practice/topics?subject=X` e lista os assuntos daquela matéria com contagem, cada um linkando para `/pratica/[subject]/[topicId]`.

**`app/pratica/[subject]/[topicId]/page.tsx`** (novo) — Client Component, o loop de prática em si:
- Ao montar, busca `GET /api/practice/questions?topicId=X`, embaralha o array uma única vez (`useState` com inicialização lazy, não re-embaralha em re-renders).
- Estado: índice da questão atual, alternativa selecionada, resultado da tentativa atual (antes/depois de responder), contador de acertos.
- Antes de responder: mostra enunciado + alternativas clicáveis.
- Ao clicar numa alternativa: dispara `POST /api/practice/attempts`, e com a resposta pinta a alternativa escolhida (verde se `isCorrect`, vermelho se não) e destaca a `correctAnswer` retornada; mostra botão "Próxima".
- Ao clicar "Próxima": avança o índice; se não há mais questões, mostra a tela de resumo ("Você acertou X de Y") com botão "Voltar aos assuntos" (`/pratica/[subject]`).
- Se o assunto não tiver nenhuma questão disponível (lista vazia), mostra mensagem "Nenhuma questão disponível ainda para este assunto" em vez de iniciar a sessão.

### Fluxo de dados

```
/pratica → GET /api/practice/subjects
  → clica matéria → /pratica/[subject] → GET /api/practice/topics?subject=X
    → clica assunto → /pratica/[subject]/[topicId] → GET /api/practice/questions?topicId=X
      → embaralha no cliente → mostra questão 1
        → aluno responde → POST /api/practice/attempts → mostra feedback
          → "Próxima" → repete até acabar → tela de resumo
```

### Tratamento de erros

- Qualquer rota retornando 401 (sessão expirada/ausente) → redireciona para `/entrar` (mesmo padrão já usado no resto do site).
- Assunto sem questões aprovadas disponíveis → mensagem informativa, não erro — a sessão simplesmente não inicia.
- Falha de rede/servidor ao buscar as questões do assunto (`GET .../questions`) → mensagem de erro com opção de tentar de novo, mesmo padrão de `/admin/revisao`.
- Falha ao gravar uma tentativa (`POST .../attempts`) → não trava a sessão do aluno. Mostra um aviso discreto ("não foi possível salvar essa resposta") mas revela o feedback certo/errado normalmente (calculado a partir da resposta da própria requisição, quando ela chega) e permite seguir para a próxima questão — perder uma linha de histórico não deve impedir o aluno de continuar praticando.

## Testes

Mesmo padrão do projeto: testes de rota contra Postgres real (como `tests/admin-questions-api.test.ts`), não mocks.

- `GET /api/practice/subjects` e `/topics`: 401 sem sessão; contagens corretas; exclui questões não-aprovadas e `correctAnswer='Anulado'`; matéria/assunto sem questões não aparece na listagem.
- `GET /api/practice/questions`: 401 sem sessão; retorna só questões aprovadas e não-anuladas do `topicId`; **resposta não contém o campo `correctAnswer`**.
- `POST /api/practice/attempts`: 401 sem sessão; calcula `isCorrect` corretamente comparando com o gabarito real (não confia no que o cliente diz); grava a linha em `attempts`; 404 para `questionId` inexistente.

Sem testes automatizados para os componentes de página (Client Components de UI) — verificação manual via navegador real, mesmo padrão usado nas telas de `/entrar` e `/admin/revisao`: escolher matéria → assunto → responder algumas questões (acertando e errando de propósito) → conferir feedback visual → chegar ao resumo → voltar.

## Self-Review Notes

- **Cobertura:** cobre o loop completo confirmado nas três sessões de brainstorm (navegação em 2 telas, sessão sem paginação, feedback imediato, ordem embaralhada, resumo final, persistência de tentativas) sem introduzir nenhuma lógica adaptativa fora de escopo.
- **Consistência:** `correctAnswer` nunca trafega para o cliente antes da resposta — decisão de segurança explícita, coerente com o fato de que `EditQuestionDialog` (admin) já trata `correctAnswer` como dado sensível de curadoria, não de exibição ao aluno.
- **Sem ambiguidade:** a ausência de "sessão" persistida no servidor está registrada tanto no modelo de dados quanto na decisão de não-retomada — as duas seções não se contradizem. Mapeamento matéria→`subject` e assunto→`topics.name` segue o mesmo vocabulário já usado em `/admin/revisao` (`{subject} — {name}`).
- **Escopo:** focado o suficiente para um único plano de implementação — uma tabela nova, quatro rotas, três páginas, nenhuma dependência de subsistemas futuros.
