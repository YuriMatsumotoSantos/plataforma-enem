"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type RedacaoDetalhe = {
  id: string;
  text: string;
  notaTotal: number;
  scores: {
    competencia1: number;
    competencia2: number;
    competencia3: number;
    competencia4: number;
    competencia5: number;
  };
  feedback: { justificativas: string[]; comentarioGeral: string };
};

const COMPETENCIA_LABELS = [
  "Competência 1, Norma culta",
  "Competência 2, Compreensão do tema",
  "Competência 3, Argumentação",
  "Competência 4, Coesão e coerência",
  "Competência 5, Proposta de intervenção",
];

export default function ResultadoRedacaoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [redacao, setRedacao] = useState<RedacaoDetalhe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/redacao/redacoes/${params.id}`)
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (response.status === 404) {
          throw new Error("Redação não encontrada.");
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar a redação.");
        }
        return response.json();
      })
      .then((data: RedacaoDetalhe | null) => {
        if (cancelled || data === null) return;
        setRedacao(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [router, params.id]);

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-destructive">{error}</p>
      </main>
    );
  }

  if (!redacao) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <p>Carregando...</p>
      </main>
    );
  }

  const scores = [
    redacao.scores.competencia1,
    redacao.scores.competencia2,
    redacao.scores.competencia3,
    redacao.scores.competencia4,
    redacao.scores.competencia5,
  ];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Resultado</h1>
        <Badge className="text-lg">{redacao.notaTotal} / 1000</Badge>
      </div>

      <div className="flex flex-col gap-3">
        {COMPETENCIA_LABELS.map((label, i) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between">
              <p className="font-medium">{label}</p>
              <Badge variant="outline">{scores[i]} / 200</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{redacao.feedback.justificativas[i]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {redacao.feedback.comentarioGeral && (
        <Card>
          <CardHeader>
            <p className="font-medium">Comentário geral</p>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{redacao.feedback.comentarioGeral}</p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
