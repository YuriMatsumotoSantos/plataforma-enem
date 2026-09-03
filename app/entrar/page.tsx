"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

    try {
      const { data, error: signInError } = await authClient.signIn.email({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message ?? "Não foi possível entrar.");
        return;
      }

      const role = (data?.user as { role?: string } | undefined)?.role;
      redirectByRole(role);
    } catch {
      setError("Não foi possível conectar. Verifique sua internet e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { data, error: signUpError } = await authClient.signUp.email({
        name,
        email,
        password,
      });

      if (signUpError) {
        setError(signUpError.message ?? "Não foi possível criar a conta.");
        return;
      }

      const role = (data?.user as { role?: string } | undefined)?.role;
      redirectByRole(role);
    } catch {
      setError("Não foi possível conectar. Verifique sua internet e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">
            {mode === "login" ? "Entrar" : "Criar conta"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              void (mode === "login" ? handleLogin(event) : handleSignUp(event));
            }}
            className="flex flex-col gap-4"
          >
            {mode === "cadastro" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  type="text"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={loading}>
              {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          <Button
            type="button"
            variant="link"
            className="mt-2 px-0"
            onClick={() => {
              setMode(mode === "login" ? "cadastro" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "Criar conta" : "Já tenho conta — entrar"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
