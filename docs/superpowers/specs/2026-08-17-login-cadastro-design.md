# Tela de login/cadastro — Design

**Data:** 2026-08-17
**Status:** Aprovado para planejamento de implementação

## Contexto e motivação

A Fundação (subsistema 1) construiu o backend completo de autenticação (Better Auth, hashing de senha, sessão via cookie, cliente de API `lib/auth-client.ts`) mas nenhuma tela para o usuário efetivamente logar ou se cadastrar pelo navegador. Isso foi descoberto como um bloqueador real durante o Banco de questões + curadoria (subsistema 2): o founder não tinha como acessar `/admin/revisao` para revisar as 180 questões reais já extraídas, porque não existe formulário algum em `app/` — só endpoints de API (`/api/auth/[...all]`).

Este é um pré-requisito pequeno e independente, necessário tanto para a curadoria administrativa imediata quanto para qualquer subsistema futuro voltado ao aluno (Prática por assunto, Simulados, Dashboard). Por isso ganha seu próprio ciclo curto de brainstorm → spec → plano, antes de retomar o brainstorm de Prática por assunto que estava em andamento.

## Escopo

- Uma página (`/entrar`) com formulário de login por padrão e alternância para formulário de cadastro, na mesma tela, sem navegação entre rotas.
- Um cabeçalho compartilhado (aparece em todas as páginas) mostrando link "Entrar" quando deslogado, ou nome do usuário + botão "Sair" quando logado.
- Redirecionamento pós-login/cadastro baseado no `role` do usuário.

Fora de escopo (decisões adiadas, não bloqueiam este subsistema):
- Verificação de e-mail (`requireEmailVerification: false`, já assim hoje)
- Recuperação de senha ("esqueci minha senha")
- Login social (Google, etc.)
- Qualquer área/dashboard do aluno — a home (`/`) continua sendo o placeholder atual do `create-next-app` até o subsistema de Prática por assunto (ou outro) construir algo real ali

## Arquitetura

Segue o padrão já estabelecido no projeto (Client Components consumindo o backend de auth já existente), sem introduzir rotas de API novas — `/api/auth/[...all]` (Better Auth) já cobre sign-up, sign-in e sign-out.

### Componentes

**`app/entrar/page.tsx`** (novo) — Client Component (`"use client"`).
- Estado local (`useState`) alterna entre modo "login" e modo "cadastro" na mesma tela — sem troca de rota.
- Modo login: campos email + senha, chama `authClient.signIn.email({ email, password })`.
- Modo cadastro: campos nome + email + senha, chama `authClient.signUp.email({ email, password, name })` (schema exige `name` não-nulo).
- Em caso de erro (senha incorreta, e-mail já cadastrado, senha curta demais etc.), exibe a mensagem retornada pelo Better Auth inline no formulário, sem stack trace nem detalhe interno.
- Em caso de sucesso, lê o `role` do usuário retornado na resposta e redireciona via `useRouter().push(...)`: `admin` → `/admin/revisao`, `aluno` → `/`.

**`app/components/Header.tsx`** (novo) — Client Component.
- Usa o hook `authClient.useSession()` (já exportado por `lib/auth-client.ts`) para saber se há sessão ativa, sem chamada manual a `/api/me`.
- Deslogado: link "Entrar" apontando para `/entrar`.
- Logado: nome do usuário (`session.user.name`) + botão "Sair", que chama `authClient.signOut()` e redireciona para `/`.

**`app/layout.tsx`** (modificar) — inclui `<Header />` no topo, acima de `{children}`, para aparecer em toda página do site.

### Fluxo de dados

Nenhuma tabela ou rota nova. Todo o fluxo consome o backend de auth já existente e testado (`tests/auth.test.ts` cobre sign-up/sign-in no nível de API); esta tela é puramente a camada de apresentação sobre esse backend.

## Testes

Sem testes automatizados novos — a lógica de autenticação em si já tem cobertura real de teste contra o Postgres local (`tests/auth.test.ts`). Esta tela é verificada manualmente, seguindo o mesmo padrão já usado na tela `/admin/revisao` (Task 11 do subsistema anterior): cadastrar uma conta nova pelo formulário, logar, confirmar redirecionamento correto por `role`, testar "Sair", testar mensagem de erro com senha incorreta.

## Self-Review Notes

- **Cobertura:** cobre exatamente o gap identificado (nenhuma tela de auth existia) sem expandir escopo para recuperação de senha, login social ou área do aluno — todos adiados explicitamente.
- **Consistência:** reutiliza `lib/auth-client.ts` (já existente, nunca consumido até agora) e o padrão de Client Component + backend já testado, mesmo estilo usado em `/admin/revisao`.
- **Sem ambiguidade:** todos os campos, redirecionamentos e mensagens de erro têm comportamento definido; nenhuma seção depende de decisão futura não registrada.
