"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type FielOption = {
  year: number;
  examDay: number;
  aprovadas: number;
  necessarias: number;
  disponivel: boolean;
};

type MescladoOption = {
  examDay: 1 | 2;
  areas: { area: string; aprovadas: number; necessarias: number }[];
  disponivel: boolean;
};

const AREA_LABELS: Record<string, string> = {
  linguagens: "Linguagens",
  humanas: "Humanas",
  natureza: "Natureza",
  matematica: "Matemática",
};

export default function SimuladosPage() {
  const router = useRouter();
  const [fiel, setFiel] = useState<FielOption[] | null>(null);
  const [mesclado, setMesclado] = useState<MescladoOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [limitReached, setLimitReached] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/simulados/available")
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar simulados disponíveis. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || data === null) return;
        setFiel(data.fiel);
        setMesclado(data.mesclado);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleStart(body: {
    mode: "fiel" | "mesclado";
    examDay: number;
    examYear?: number;
  }) {
    setCreating(true);
    setError(null);
    setLimitReached(false);
    try {
      const response = await fetch("/api/simulados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        router.push("/entrar");
        return;
      }
      if (response.status === 402) {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? "Limite do plano grátis atingido.");
        setLimitReached(true);
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? "Não foi possível iniciar o simulado.");
        return;
      }
      const data = await response.json();
      router.push(`/simulados/${data.id}`);
    } catch {
      setError("Não foi possível iniciar o simulado.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Simulados</h1>
        <Link href="/simulados/historico" className="text-sm underline">
          Histórico
        </Link>
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {limitReached && (
        <Link href="/planos" className="text-sm underline">
          Ver planos
        </Link>
      )}
      {!fiel && !mesclado && !error && <p>Carregando...</p>}

      {mesclado && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Mesclado</h2>
          <p className="text-sm text-muted-foreground">
            45 questões de cada área, sorteadas entre todos os anos disponíveis.
          </p>
          {mesclado.map((option) => (
            <Card key={option.examDay}>
              <CardHeader className="flex flex-row items-center justify-between">
                <p className="font-medium">Dia {option.examDay}</p>
                {option.disponivel ? (
                  <Button
                    type="button"
                    disabled={creating}
                    onClick={() => handleStart({ mode: "mesclado", examDay: option.examDay })}
                  >
                    Iniciar
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">Indisponível</p>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
                {option.areas.map((area) => (
                  <p key={area.area}>
                    {AREA_LABELS[area.area] ?? area.area}: {area.aprovadas}/{area.necessarias}{" "}
                    aprovadas
                  </p>
                ))}
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {fiel && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Fiel a uma prova real</h2>
          <p className="text-sm text-muted-foreground">
            As mesmas 90 questões de um dia real do ENEM, na ordem original.
          </p>
          {fiel.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum exame com dados suficientes ainda.
            </p>
          )}
          {fiel.map((option) => (
            <Card key={`${option.year}-${option.examDay}`}>
              <CardHeader className="flex flex-row items-center justify-between">
                <p className="font-medium">
                  ENEM {option.year} — Dia {option.examDay}
                </p>
                {option.disponivel ? (
                  <Button
                    type="button"
                    disabled={creating}
                    onClick={() =>
                      handleStart({ mode: "fiel", examDay: option.examDay, examYear: option.year })
                    }
                  >
                    Iniciar
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {option.aprovadas}/{option.necessarias} aprovadas
                  </p>
                )}
              </CardHeader>
            </Card>
          ))}
        </section>
      )}
    </main>
  );
}
