"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type StripeActionResponse = { error?: string; url?: string };

function PlanosContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [plan, setPlan] = useState<"free" | "premium" | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sucesso = searchParams.get("sucesso") === "1";

  useEffect(() => {
    fetch("/api/me")
      .then((response) =>
        response.ok ? (response.json() as Promise<{ plan: "free" | "premium" }>) : null
      )
      .then((body) => setPlan(body?.plan ?? null))
      .catch(() => setPlan(null))
      .finally(() => setLoadingPlan(false));
  }, []);

  async function handleAssinar() {
    setRedirecting(true);
    setError(null);
    try {
      const response = await fetch("/api/stripe/checkout", { method: "POST" });
      if (response.status === 401) {
        router.push("/entrar");
        return;
      }
      if (!response.ok) {
        const body = (await response
          .json()
          .catch(() => null)) as StripeActionResponse | null;
        setError(body?.error ?? "Não foi possível iniciar o checkout.");
        setRedirecting(false);
        return;
      }
      const body = (await response.json()) as StripeActionResponse;
      if (body.url) window.location.href = body.url;
    } catch {
      setError("Não foi possível iniciar o checkout.");
      setRedirecting(false);
    }
  }

  async function handleGerenciar() {
    setRedirecting(true);
    setError(null);
    try {
      const response = await fetch("/api/stripe/portal", { method: "POST" });
      if (!response.ok) {
        const body = (await response
          .json()
          .catch(() => null)) as StripeActionResponse | null;
        setError(body?.error ?? "Não foi possível abrir o portal de assinatura.");
        setRedirecting(false);
        return;
      }
      const body = (await response.json()) as StripeActionResponse;
      if (body.url) window.location.href = body.url;
    } catch {
      setError("Não foi possível abrir o portal de assinatura.");
      setRedirecting(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8">
      <h1 className="text-2xl font-semibold">Planos</h1>

      {sucesso && (
        <p className="rounded border border-green-600 bg-green-50 p-3 text-sm text-green-800">
          Assinatura confirmada! Pode levar alguns instantes para liberar no seu acesso.
        </p>
      )}
      {error && <p className="text-destructive">{error}</p>}

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <p className="text-lg font-medium">Grátis</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>20 questões de prática por dia</p>
            <p>1 simulado</p>
            <p>1 correção de redação por mês</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <p className="text-lg font-medium">Premium — R$ 29,90/mês</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground">
            <div className="flex flex-col gap-2">
              <p>Questões de prática sem limite</p>
              <p>Simulados sem limite</p>
              <p>20 correções de redação por mês</p>
            </div>
            {!loadingPlan &&
              (plan === "premium" ? (
                <Button
                  type="button"
                  disabled={redirecting}
                  onClick={() => {
                    void handleGerenciar();
                  }}
                >
                  Gerenciar assinatura
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={redirecting}
                  onClick={() => {
                    void handleAssinar();
                  }}
                >
                  Assinar
                </Button>
              ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default function PlanosPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-8">Carregando...</main>}>
      <PlanosContent />
    </Suspense>
  );
}
