# Banco de Questões + Curadoria — Design

**Data:** 2026-08-16
**Status:** Aprovado para planejamento de implementação

## Visão geral

Segundo subsistema do roadmap da Plataforma ENEM (o primeiro, Fundação, está em produção). Constrói o banco de questões reais do ENEM que os subsistemas seguintes (Prática, Simulados, Dashboard, Redação) vão consumir.

Escopo do lote inicial: **1 ano completo de prova (ENEM 2025, ~180 questões)**, para validar o pipeline inteiro antes de escalar para mais anos.

## Arquitetura geral

Duas partes com responsabilidades separadas:

1. **Script de ingestão** — roda localmente (fora do site em produção). Motivo: as funções serverless da Vercel têm limite curto de tempo de execução, insuficiente para processar ~180 chamadas sequenciais ao Gemini. O script escreve direto no mesmo banco Postgres (Supabase) que a aplicação em produção usa.
2. **Tela de revisão admin** — dentro do site Next.js já existente, rota protegida `/admin/revisao`, reaproveitando a autenticação (Better Auth) e o padrão de defesa em profundidade (middleware + validação server-side) já construídos na Fundação.

O script produz questões com status `pendente`; a tela de revisão é onde elas viram `aprovada` (visível ao resto do site) ou `rejeitada`.

## Modelo de dados

Novas tabelas em `db/schema.ts` (Drizzle), migradas com `drizzle-kit generate` + `drizzle-kit migrate`, seguindo o mesmo padrão já usado para as tabelas do Better Auth.

**`topics`** (assuntos):
- `id`, `area` (enum: `linguagens` | `humanas` | `natureza` | `matematica`), `subject` (disciplina, ex: "Física", "História"), `name` (assunto específico, ex: "Óptica — Lentes")
- Criada dinamicamente pelo script conforme o Gemini classifica questões; pode ser corrigida na revisão

**`questions`** (questões):
- `id`, `year`, `examDay` (1 ou 2), `questionNumber`, `area`
- `statement` (enunciado, texto)
- `alternatives` (as 5 alternativas A–E, guardadas juntas em um campo JSONB — sempre exatamente 5 nas questões do ENEM, não justifica tabela separada)
- `correctAnswer` (gabarito)
- `imageUrl` (nullable — nem toda questão tem figura)
- `topicId` (referência a `topics`)
- `status` (enum: `pendente` | `aprovada` | `rejeitada`)
- Restrição de unicidade em `(year, examDay, questionNumber)` — é o que permite ao script pular questões já importadas ao rodar de novo, sem duplicar

**Imagens:** armazenadas no Supabase Storage (já incluso no projeto Supabase existente, sem serviço novo).

**Papel de admin:** campo `role` (enum: `aluno` | `admin`, padrão `aluno`) adicionado à tabela `user` já existente. A conta do fundador é marcada como `admin` diretamente no banco, uma vez, manualmente — sem tela de gestão de admins por enquanto (YAGNI; só um admin no momento).

## Pipeline de ingestão (script local)

Para cada ano de prova processado, em sequência:

1. **Baixar:** PDFs oficiais da prova (todas as áreas) e do gabarito, direto do site do INEP, para o ano configurado
2. **Extrair + classificar:** para cada questão, a página correspondente do PDF é enviada ao Gemini Flash (multimodal — lê a página como imagem, sem etapa de OCR separada), pedindo um retorno estruturado: enunciado, as 5 alternativas, indicação de imagem/figura, matéria e assunto sugeridos
3. **Imagem:** se a questão tiver figura, ela é extraída da página e enviada ao Supabase Storage; a URL resultante é salva na questão
4. **Gabarito:** cruzado com o PDF oficial do gabarito para confirmar a resposta correta
5. **Gravar:** questão inserida com status `pendente`
6. **Limite de taxa:** chamadas ao Gemini espaçadas para respeitar o limite de 15 por minuto do tier gratuito — para 180 questões, o script leva cerca de 15–20 minutos rodando sozinho
7. **Idempotência:** antes de processar uma questão, o script verifica se `(year, examDay, questionNumber)` já existe no banco (em qualquer status) e pula se já existir — seguro rodar o mesmo ano mais de uma vez

**Tratamento de erro:** se o Gemini retornar uma resposta que não bate com o formato esperado para uma questão específica, essa questão é marcada e pulada (registrada em log), sem interromper o processamento das demais. Se o download do PDF falhar, o script para com uma mensagem clara antes de gastar qualquer chamada de API.

## Tela de revisão (admin)

Rota `/admin/revisao`, acessível apenas a usuários com `role: admin` (validado server-side, mesmo padrão de `app/api/me/route.ts`).

- **Lista:** questões com status `pendente`, com filtro por ano e por matéria
- **Detalhe de cada questão:** enunciado, alternativas, gabarito, imagem (se houver), classificação sugerida
- **Ações:**
  - **Aprovar** — aceita como está; questão passa a `aprovada` e fica disponível para os demais subsistemas
  - **Editar e aprovar** — corrige qualquer campo, incluindo trocar o assunto (escolher um `topic` existente ou criar um novo) antes de aprovar
  - **Rejeitar** — descarta (ex: extração malformada, duplicata); fica marcada como `rejeitada`, o script não tenta reimportar

## Segurança

- Rota admin protegida com o mesmo padrão de defesa em profundidade já estabelecido (middleware verifica sessão presente; a rota em si valida `role: admin` no servidor antes de qualquer leitura/escrita)
- Chave da API do Gemini fica apenas em variável de ambiente local (`.env.local`), nunca commitada — mesmo padrão já usado para `DATABASE_URL` e `BETTER_AUTH_SECRET`
- Script de ingestão roda localmente, com suas próprias credenciais (a `DATABASE_URL` de produção), nunca exposto como rota pública

## Testes

- Testes de integração para a rota `/admin/revisao` e suas ações (aprovar/editar/rejeitar), cobrindo: usuário sem sessão (401), usuário `aluno` sem privilégio (403), usuário `admin` (200 e mudança de status persistida) — mesmo padrão dos testes já existentes para `/api/me`
- Teste de schema/migração das novas tabelas (`topics`, `questions`, `user.role`), seguindo o padrão de `tests/db.test.ts`
- O script de ingestão em si (chamadas reais ao Gemini, download de PDF) não é coberto por teste automatizado de CI — é uma ferramenta de curadoria rodada manualmente, verificada na prática ao processar o lote inicial de 2025. A lógica de idempotência (pular questão já existente) é testável isoladamente com dados fake, sem chamar a API de verdade

## Fora de escopo / decisões adiadas

- Processar anos além de 2025 (decisão explícita: validar o pipeline com 1 ano antes de escalar)
- Múltiplos administradores / tela de gestão de papéis
- Uso do banco de questões pelos subsistemas de Prática/Simulados (specs próprias, futuras)
- Re-classificação em massa de questões já aprovadas
