"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";

type SimuladoHistoryItem = {
  id: string;
  mode: "mesclado" | "fiel";
  examDay: number;
  examYear: number | null;
  status: "em_andamento" | "finalizado";
  startedAt: string;
  finishedAt: string | null;
  score: { acertos: number; total: number } | null;
};

export default function SimuladosHistoricoPage() {
  const router = useRouter();
  const [history, setHistory] = useState<SimuladoHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/simulados")
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar histórico. Tente novamente.");
        }
        return response.json();
      })
      .then((data: { simulados: SimuladoHistoryItem[] } | null) => {
        if (cancelled || data === null) return;
        setHistory(data.simulados);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Histórico de simulados</h1>
        <Link href="/simulados" className="text-sm underline">
          ← Novo simulado
        </Link>
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!history && !error && <p>Carregando...</p>}
      {history && history.length === 0 && (
        <p className="text-muted-foreground">Você ainda não fez nenhum simulado.</p>
      )}

      {history && history.length > 0 && (
        <div className="flex flex-col gap-3">
          {history.map((item) => (
            <Link
              key={item.id}
              href={
                item.status === "finalizado"
                  ? `/simulados/${item.id}/resultado`
                  : `/simulados/${item.id}`
              }
            >
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {item.mode === "fiel" ? `ENEM ${item.examYear}` : "Mesclado"} — Dia{" "}
                      {item.examDay}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(item.startedAt).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  {item.status === "finalizado" && item.score ? (
                    <p className="text-sm font-medium">
                      {item.score.acertos}/{item.score.total}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Continuar</p>
                  )}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
