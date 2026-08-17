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
