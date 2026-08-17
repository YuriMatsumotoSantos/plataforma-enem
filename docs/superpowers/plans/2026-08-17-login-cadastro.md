# Tela de login/cadastro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-facing login/signup screen and a shared header, so a real user can authenticate through the site for the first time — the backend (Better Auth, `lib/auth-client.ts`) already exists but no form does.

**Architecture:** Two independent Client Components consuming the already-working Better Auth client SDK (`lib/auth-client.ts`) — no new API routes, no schema changes. `/entrar` toggles between a login form and a signup form in local state. A shared `Header` component (mounted in `app/layout.tsx`) reads session state via `authClient.useSession()` and shows either an "Entrar" link or the user's name + a sign-out button.

**Tech Stack:** Next.js 15 App Router, React Client Components, Tailwind v4 (utility classes, no new dependency), Better Auth client (`better-auth/react`, already installed and used by `lib/auth-client.ts`).

## Global Constraints

- TypeScript em todo o código novo (herdado da Fundação)
- Sem rota de API nova — todo o fluxo consome `/api/auth/[...all]` (Better Auth) já existente e já testado em `tests/auth.test.ts`
- Sem verificação de e-mail nesta fase (`requireEmailVerification: false`, já configurado em `lib/auth.ts`)
- Sem testes automatizados novos para esta feature — verificação manual apenas (decisão do spec, mesma abordagem já usada na Task 11 de `/admin/revisao`)
- Erros exibidos ao usuário nunca expõem detalhe técnico interno (mensagem do Better Auth, não stack trace) — herdado da Fundação (Segurança: "nunca expor stack trace ou mensagem de erro interna")

---

## File Structure

```
plataforma-enem/
  app/
    entrar/
      page.tsx                  # NOVO: formulário de login/cadastro com alternador
    components/
      Header.tsx                # NOVO: cabeçalho compartilhado (Entrar / nome+Sair)
    layout.tsx                  # MODIFY: monta <Header /> acima de {children}
```

---

## Task 1: Tela `/entrar` — login e cadastro

**Files:**
- Create: `app/entrar/page.tsx`

**Interfaces:**
- Consumes: `authClient` de `@/lib/auth-client` (já existe) — `authClient.signIn.email({ email, password })` e `authClient.signUp.email({ name, email, password })`, ambos retornam `{ data, error }` (confirmado empiricamente: `error` é `{ message, code, status, statusText } | null`; `data?.user` inclui o campo customizado `role`)
- Produces: rota `/entrar`, consumida pelo `Header` (Task 2) como destino do link "Entrar"

Esta é uma tela puramente de apresentação sobre um backend já testado — sem teste automatizado, conforme o spec. A verificação é manual (Step 3).

- [ ] **Step 1: Implementar a página**

Create `app/entrar/page.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type Mode = "login" | "cadastro";

export default function EntrarPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function redirectByRole(role: string | undefined) {
    router.push(role === "admin" ? "/admin/revisao" : "/");
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error: signInError } = await authClient.signIn.email({
      email,
      password,
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message ?? "Não foi possível entrar.");
      return;
    }

    const role = (data?.user as { role?: string } | undefined)?.role;
    redirectByRole(role);
  }

  async function handleSignUp(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error: signUpError } = await authClient.signUp.email({
      name,
      email,
      password,
    });

    setLoading(false);

    if (signUpError) {
      setError(signUpError.message ?? "Não foi possível criar a conta.");
      return;
    }

    const role = (data?.user as { role?: string } | undefined)?.role;
    redirectByRole(role);
  }

  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold">
        {mode === "login" ? "Entrar" : "Criar conta"}
      </h1>

      <form
        onSubmit={mode === "login" ? handleLogin : handleSignUp}
        className="flex flex-col gap-4"
      >
        {mode === "cadastro" && (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Nome</span>
            <input
              type="text"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">E-mail</span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Senha</span>
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "login" ? "cadastro" : "login");
          setError(null);
        }}
        className="text-sm text-zinc-600 underline dark:text-zinc-400"
      >
        {mode === "login" ? "Criar conta" : "Já tenho conta — entrar"}
      </button>
    </main>
  );
}
```

- [ ] **Step 2: Rodar lint, build e typecheck**

Run: `npm run lint && npx next build && npx tsc --noEmit`
Expected: sem erros

**Atenção:** rode nessa ordem exata (build antes de typecheck). `app/layout.tsx` usa `LayoutProps<"/">`, um tipo gerado pelo Next.js 15 dentro de `.next/types/` durante o `next build` — rodar `tsc --noEmit` antes do build produz um falso erro "Cannot find name 'LayoutProps'". Esse é o motivo do CI deste projeto rodar build antes de typecheck. Não "corrija" esse tipo se ele aparecer como erro — rode o build primeiro.

- [ ] **Step 3: Verificar manualmente**

Run: `npm run dev` (em terminal separado)

1. Acesse `http://localhost:3000/entrar` — deve mostrar o formulário de login.
2. Clique em "Criar conta" — deve trocar para o formulário de cadastro (nome, e-mail, senha) sem navegar para outra URL.
3. Tente cadastrar com uma senha muito curta (ex: `123`) — deve mostrar uma mensagem de erro inline (texto do Better Auth), não travar nem mostrar tela em branco.
4. Cadastre uma conta real com dados válidos — deve redirecionar para `/` (papel padrão é `aluno`).
5. Clique em "Já tenho conta — entrar", tente logar com a senha errada — deve mostrar mensagem de erro inline.
6. Logue com a senha correta — deve redirecionar para `/` novamente.

Pare o servidor de desenvolvimento depois de confirmar.

- [ ] **Step 4: Commit**

```bash
git add app/entrar/page.tsx
git commit -m "feat: add login/signup screen at /entrar"
```

---

## Task 2: Cabeçalho compartilhado

**Files:**
- Create: `app/components/Header.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `authClient` de `@/lib/auth-client` — `authClient.useSession()` retorna `{ data, isPending, isRefetching, error, refetch }`, onde `data` é `null`/`undefined` quando deslogado ou `{ user: {..., name, role}, session: {...} }` quando logado (confirmado via os tipos do client em `node_modules/better-auth/dist/client/react/index.d.mts`); `authClient.signOut()` encerra a sessão
- Produces: componente `Header`, montado em todas as páginas via `app/layout.tsx`

Sem teste automatizado — verificação manual (Step 4).

- [ ] **Step 1: Implementar o componente**

Create `app/components/Header.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function Header() {
  const router = useRouter();
  const { data, isPending } = authClient.useSession();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <Link href="/" className="font-semibold">
        Plataforma ENEM
      </Link>

      {isPending ? null : data?.user ? (
        <div className="flex items-center gap-3 text-sm">
          <span>{data.user.name}</span>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded border border-zinc-300 px-3 py-1 dark:border-zinc-700"
          >
            Sair
          </button>
        </div>
      ) : (
        <Link href="/entrar" className="text-sm underline">
          Entrar
        </Link>
      )}
    </header>
  );
}
```

- [ ] **Step 2: Montar o Header no layout**

Modify `app/layout.tsx` — adicione o import e monte `<Header />` como primeiro filho de `<body>`, antes de `{children}`:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "./components/Header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Plataforma ENEM",
  description: "Plataforma de estudos para o ENEM",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Header />
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Rodar lint, build e typecheck**

Run: `npm run lint && npx next build && npx tsc --noEmit`
Expected: sem erros; `next build` deve listar `/entrar` entre as rotas geradas

**Atenção:** rode nessa ordem exata (build antes de typecheck) — ver nota da Task 1, Step 2, sobre `LayoutProps<"/">`.

- [ ] **Step 4: Verificar manualmente**

Run: `npm run dev` (em terminal separado)

1. Acesse `http://localhost:3000/` deslogado — o cabeçalho deve mostrar o link "Entrar".
2. Clique em "Entrar", faça login com a conta criada na Task 1 — depois do redirecionamento, o cabeçalho deve mostrar o nome do usuário e o botão "Sair" em qualquer página que você visitar.
3. Clique em "Sair" — deve voltar para `/` e o cabeçalho deve voltar a mostrar "Entrar".

Pare o servidor de desenvolvimento depois de confirmar.

- [ ] **Step 5: Commit**

```bash
git add app/components/Header.tsx app/layout.tsx
git commit -m "feat: add shared header with session-aware entrar/sair"
```

---

## Self-Review Notes

- **Cobertura do spec:** cobre as duas peças do spec — tela `/entrar` com alternador (Task 1) e cabeçalho compartilhado com redirecionamento por role (Task 1 faz o redirecionamento pós-auth; Task 2 faz a exibição de sessão persistente). Nenhuma seção do spec ficou sem task correspondente.
- **Sem placeholders:** todo código é completo e executável, sem "TODO" ou "adicionar validação depois".
- **Consistência de tipos:** `authClient` é importado identicamente em ambas as tasks; o padrão de leitura de `role` (`(data?.user as { role?: string } | undefined)?.role`) é o mesmo cast defensivo já usado em `lib/admin.ts` para o mesmo campo, então fica consistente com o restante do código-base.
- **Ordem das tasks:** Task 1 antes da Task 2 porque o link "Entrar" do Header (Task 2) só faz sentido apontar para uma rota que já existe — mas nenhuma delas depende de código da outra (arquivos totalmente disjuntos), então poderiam em tese ser implementadas em paralelo se necessário.
