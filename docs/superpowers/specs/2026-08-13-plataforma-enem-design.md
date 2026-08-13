# Plataforma de Estudos para ENEM — Design

**Data:** 2026-08-13
**Status:** Aprovado para planejamento de implementação

## Visão geral

Produto web (site) para alunos de cursinho estudando para o ENEM, com plano de expansão futura para outras bancas de vestibular (ex: USP/Fuvest). A tese central do produto: estudar respondendo questões reais (active recall) é mais eficaz do que estudar por conteúdo passivo, porque cada banca tem sua própria forma de cobrar o mesmo conhecimento — o aluno precisa treinar a "linguagem" da banca, não só o conteúdo.

O MVP inclui o ciclo completo (não uma versão reduzida), porque o produto só é vendável se entregar o fluxo inteiro: praticar → errar → entender onde errou → treinar o ponto fraco → escrever redação → receber feedback.

### Escopo do MVP

- Banco de questões reais de provas passadas do ENEM, organizado por matéria → assunto
- Prática dirigida por assunto específico (ex: Física → Óptica → Lentes)
- Simulados completos no formato oficial de 2 dias
- Dashboard de desempenho (o que estudou, o que errou, assunto mais fraco)
- Motor de recomendação adaptativa (prioriza questões do assunto mais fraco)
- Correção de redação por IA com feedback pelas 5 competências oficiais do ENEM
- Cadastro/login de usuário
- Modelo de negócio freemium

Fora de escopo do MVP (fases futuras): outras bancas de vestibular além do ENEM, apps nativos (iOS/Android), geração de questões inéditas por IA.

## Arquitetura técnica

Stack escolhida por ser o padrão de mercado hoje (2026) para SaaS — TypeScript ponta a ponta, facilita contratação futura e manutenção:

- **Frontend:** Next.js 15 + React + TypeScript + Tailwind + shadcn/ui
- **Backend:** API routes do próprio Next.js
- **Banco de dados:** PostgreSQL (Supabase ou Neon)
- **Autenticação:** Better Auth
- **Pagamento:** Stripe (assinatura recorrente)
- **IA (correção de redação + classificação de questões na fase de curadoria):** API da Anthropic (Claude)
- **Hospedagem:** Vercel + banco de dados gerenciado (Supabase/Neon)

## Segurança

Plano de segurança incorporado ao design desde o início (privacy/security by design), não como item posterior.

### Autenticação e sessão
- Better Auth com hashing de senha via bcrypt/argon2
- Verificação de e-mail no cadastro
- Rate-limiting nas tentativas de login (proteção contra força bruta)
- Cookies de sessão `httpOnly` + `secure` + `sameSite`

### Autorização
- Toda rota de API valida a sessão do usuário no servidor
- Papéis separados: aluno vs admin (revisão da classificação de questões feita pela IA)

### OWASP Top 10 (2025) e riscos comuns
- **SQL Injection:** ORM com queries parametrizadas (Prisma/Drizzle), nunca SQL concatenado
- **XSS:** conteúdo gerado por usuário (redação, respostas) sempre tratado como texto, nunca renderizado como HTML cru
- **CSRF:** coberto nativamente por Next.js + Better Auth com cookies same-site
- **Segredos:** chaves de API (Anthropic, Stripe) só em variáveis de ambiente no servidor
- **Falhas na cadeia de suprimentos de software:** inventário de dependências (SBOM), versões travadas, scan automático de vulnerabilidades no CI (`npm audit`/Dependabot)
- **Configuração de segurança:** headers HTTP corretos (CSP), Row Level Security no Postgres antes de produção
- **Tratamento de erros:** nunca expor stack trace ou mensagem de erro interna ao usuário final

### Abuso e custo
- Rate limit por usuário nas rotas que chamam IA, para evitar abuso ou custo descontrolado

### Pagamento
- Nenhum dado de cartão é processado diretamente — tudo via Stripe Checkout (PCI-compliant)

### LGPD (obrigatório — parte do público pode ser menor de idade)
- Política de privacidade e termos de uso desde o dia 1
- Consentimento explícito no cadastro; atenção à ECA Digital para usuários menores de 18 anos
- Minimização de dados: coletar só o estritamente necessário
- Direito do usuário de exportar/excluir seus dados
- Registro auditável de consentimentos

### Infraestrutura
- HTTPS obrigatório em tudo
- Validação de toda entrada do usuário no servidor via schemas (Zod)
- Backup automático do banco de dados
- Log de eventos sensíveis (login falho, erros de servidor, uso anômalo de IA)

## Pipeline de dados — extração e classificação de questões

Processo de curadoria interna (não é uma feature visível ao aluno), executado uma única vez por leva de provas, sem custo de API de IA paga:

1. **Ingestão:** download dos PDFs oficiais das provas + gabaritos do INEP (domínio público)
2. **Extração de texto/layout (grátis):** OCR open-source auto-hospedado (Surya OCR como primeira opção, PaddleOCR como alternativa) — sem custo de API
3. **Estruturação e classificação (grátis):** modelo com tier gratuito (Gemini Flash-Lite) decompõe cada questão em enunciado, alternativas, gabarito, ano, número, imagem associada, e sugere `matéria` + `assunto` — validado por schema antes de entrar no fluxo de revisão
4. **Revisão humana:** tela interna administrativa lista questões extraídas com a classificação sugerida pré-preenchida; revisor só corrige o que estiver errado
5. **Armazenamento:** questão aprovada entra no banco Postgres, pronta para alimentar prática, simulados e o motor de recomendação

A API paga da Anthropic (Claude) fica reservada para a correção de redação (feature recorrente por usuário), não para esta etapa de curadoria única.

## Prática, simulados e métodos de estudo

### Prática por assunto
Aluno escolhe matéria → assunto específico (ex: Física → Óptica → Lentes) e responde questões reais classificadas daquele assunto.

### Simulados
Estrutura fiel ao formato oficial do ENEM, em 2 dias:

- **Dia 1:** 45 questões de Linguagens, Códigos e suas Tecnologias + 45 questões de Ciências Humanas e suas Tecnologias + Redação (dissertativo-argumentativo, até 30 linhas)
- **Dia 2:** 45 questões de Matemática e suas Tecnologias + 45 questões de Ciências da Natureza e suas Tecnologias

Duas formas de montar o simulado:
- **Prova completa real:** usa uma prova inteira de um ano específico
- **Simulado misto:** combina questões de anos diferentes, sempre respeitando a mesma proporção por área/dia da prova oficial (nunca desbalanceado)

Flexibilidade: aluno pode fazer os 2 dias completos, ou só o Dia 1, ou só o Dia 2, isoladamente.

### Métodos de estudo (selecionáveis pelo aluno)
Todos os métodos têm como base comum o **active recall** (responder questões reais, não reler resumo) — não é um modo à parte, é o motor de todo o produto.

- **Repetição Espaçada (padrão):** motor FSRS (algoritmo de repetição espaçada open-source, estado da arte atual) decide quando reapresentar cada questão errada
- **Prática Intercalada:** mistura matérias/assuntos diferentes numa mesma sessão de estudo
- **Prática em Bloco:** foca um assunto só até atingir um critério de domínio (ex: 90% de acerto) antes de liberar o próximo assunto

### Dashboard
Por matéria e por assunto específico:
- Percentual de acerto (mastery)
- Quantidade de questões respondidas
- Lista de questões erradas para revisar
- Ranking dos assuntos com mais erro

### Motor de recomendação adaptativa
- Toda resposta do aluno (certa/errada, assunto, timestamp) é registrada
- Taxa de erro por assunto é calculada e usada para priorizar esses assuntos nas próximas sessões
- FSRS decide o timing de reapresentação das questões erradas, de acordo com o método de estudo escolhido

## Correção de redação por IA

1. Aluno escreve a redação no editor do site (dissertativo-argumentativo, contador de linhas, limite de 30 linhas)
2. Envia para correção
3. Claude avalia usando a rubrica oficial das 5 competências do ENEM (0–200 cada, total 1000), com prompt calibrado com exemplos reais de redações já corrigidas oficialmente pelo INEP (few-shot), para aumentar a precisão nas competências mais subjetivas (Competência 3 – argumentação, Competência 5 – proposta de intervenção)
4. Retorno ao aluno: nota total + nota detalhada por competência + feedback específico (pontos fortes e pontos a melhorar) em cada uma
5. Histórico de redações salvo no perfil do aluno, para acompanhar evolução ao longo do tempo
6. Sujeito ao limite do plano freemium (redações grátis limitadas por mês, ilimitado no plano pago)

## Modelo de negócio

**Freemium**, seguindo o modelo validado por concorrentes diretos (ex: Estuda.com):
- **Plano grátis:** banco de questões com limite diário, número limitado de simulados, relatório de desempenho básico, poucas correções de redação por mês
- **Plano pago (assinatura mensal via Stripe):** acesso ilimitado a questões, simulados, dashboard completo e correções de redação

Preços de referência de mercado (pesquisados): concorrentes cobram entre R$ 22–45/mês. Preço final do plano pago a definir mais adiante (fora do escopo deste documento).

## Fora de escopo / decisões adiadas

- Cálculo de custo por usuário da correção de redação via API da Anthropic (feature recorrente — calcular quando houver definição de preço do plano pago)
- Preço final do plano de assinatura
- Expansão para outras bancas de vestibular além do ENEM
- Apps nativos mobile
