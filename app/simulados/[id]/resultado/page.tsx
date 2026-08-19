"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type Alternative = { letter: string; text: string };

type AreaScore = { area: string; acertos: number; total: number };

type ReviewQuestion = {
  id: string;
  area: string;
  statement: string;
  alternatives: Alternative[];
  correctAnswer: string;
  imageUrl: string | null;
  topic: { id: string; name: string };
  selectedAnswer: string | null;
};

const AREA_LABELS: Record<string, string> = {
  linguagens: "Linguagens",
  humanas: "Humanas",
  natureza: "Natureza",
  matematica: "Matemática",
};

export default function SimuladoResultadoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { id } = params;

  const [scoreByArea, setScoreByArea] = useState<AreaScore[] | null>(null);
  const [questions, setQuestions] = useState<ReviewQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/simulados/${id}/resultado`)
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (response.status === 403) {
          throw new Error("Este simulado ainda não foi finalizado.");
        }
        if (response.status === 404) {
          throw new Error("Simulado não encontrado.");
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar o resultado. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || data === null) return;
        setScoreByArea(data.scoreByArea);
        setQuestions(data.questions);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  if (error) {
    return <p className="mx-auto max-w-2xl px-4 py-8 text-destructive">{error}</p>;
  }

  if (!scoreByArea || !questions) {
    return <p className="mx-auto max-w-2xl px-4 py-8">Carregando...</p>;
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Resultado</h1>
        <Link href="/simulados/historico" className="text-sm underline">
          ← Histórico
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        {scoreByArea.map((s) => (
          <p key={s.area}>
            {AREA_LABELS[s.area] ?? s.area}: {s.acertos}/{s.total}
          </p>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Revisão questão a questão</h2>
        {questions.map((q, index) => (
          <Card key={q.id}>
            <CardHeader>
              <p className="text-sm text-muted-foreground">
                Questão {index + 1} — {q.topic.name}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p>{q.statement}</p>
              {q.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={q.imageUrl}
                  alt="Figura da questão"
                  className="max-w-sm rounded border"
                />
              )}
              <div className="flex flex-col gap-1">
                {q.alternatives.map((alt) => {
                  const isCorrect = alt.letter === q.correctAnswer;
                  const isSelected = alt.letter === q.selectedAnswer;
                  let className = "";
                  if (isCorrect) className = "text-green-600 font-medium";
                  else if (isSelected) className = "text-destructive";
                  return (
                    <p key={alt.letter} className={className}>
                      {alt.letter}) {alt.text}
                      {isCorrect && " ✓"}
                      {isSelected && !isCorrect && " (sua resposta)"}
                    </p>
                  );
                })}
              </div>
              {q.selectedAnswer === null && (
                <p className="text-sm text-muted-foreground">Questão deixada em branco.</p>
              )}
              {q.correctAnswer === "Anulado" && (
                <p className="text-sm text-muted-foreground">Questão anulada.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
