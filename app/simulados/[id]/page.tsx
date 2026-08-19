"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type Alternative = { letter: string; text: string };

type SimuladoQuestion = {
  id: string;
  area: string;
  statement: string;
  alternatives: Alternative[];
  imageUrl: string | null;
  topic: { id: string; name: string };
};

type Answer = { selectedAnswer: string | null; markedForReview: boolean };

type SimuladoData = {
  id: string;
  mode: "mesclado" | "fiel";
  examDay: number;
  examYear: number | null;
  status: "em_andamento" | "finalizado";
  startedAt: string;
  durationSeconds: number;
  answers: Record<string, Answer>;
  questions: SimuladoQuestion[];
};

function formatTime(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const abs = Math.abs(Math.round(totalSeconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function SimuladoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { id } = params;

  const [data, setData] = useState<SimuladoData | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [finalizing, setFinalizing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/simulados/${id}`)
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (response.status === 404) {
          throw new Error("Simulado não encontrado.");
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar o simulado. Tente novamente.");
        }
        return response.json();
      })
      .then((json: SimuladoData | null) => {
        if (cancelled || json === null) return;
        if (json.status === "finalizado") {
          router.push(`/simulados/${id}/resultado`);
          return;
        }
        setData(json);
        setAnswers(json.answers);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const remainingSeconds = useMemo(() => {
    if (!data) return null;
    const elapsed = (now - new Date(data.startedAt).getTime()) / 1000;
    return data.durationSeconds - elapsed;
  }, [data, now]);

  async function saveAnswer(questionId: string, patch: Partial<Answer>) {
    const current = answers[questionId] ?? { selectedAnswer: null, markedForReview: false };
    const updated = { ...current, ...patch };
    setAnswers((prev) => ({ ...prev, [questionId]: updated }));

    try {
      const response = await fetch(`/api/simulados/${id}/respostas`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, ...patch }),
      });
      if (response.status === 401) {
        router.push("/entrar");
      }
    } catch {
      // autosave falhou silenciosamente; a resposta continua marcada localmente
      // e o próximo clique tenta salvar de novo — sem bloquear o aluno no meio da prova.
    }
  }

  async function handleFinalizar() {
    if (!data) return;
    const blanks = data.questions.filter((q) => !answers[q.id]?.selectedAnswer).length;
    if (blanks > 0) {
      const confirmed = window.confirm(
        `Você tem ${blanks} questão(ões) em branco. Finalizar mesmo assim?`
      );
      if (!confirmed) return;
    }

    setFinalizing(true);
    try {
      const response = await fetch(`/api/simulados/${id}/finalizar`, { method: "POST" });
      if (response.status === 401) {
        router.push("/entrar");
        return;
      }
      if (!response.ok) {
        setError("Não foi possível finalizar o simulado. Tente novamente.");
        setFinalizing(false);
        return;
      }
      router.push(`/simulados/${id}/resultado`);
    } catch {
      setError("Não foi possível finalizar o simulado. Tente novamente.");
      setFinalizing(false);
    }
  }

  if (error) {
    return <p className="mx-auto max-w-2xl px-4 py-8 text-destructive">{error}</p>;
  }

  if (!data) {
    return <p className="mx-auto max-w-2xl px-4 py-8">Carregando...</p>;
  }

  const question = data.questions[currentIndex];

  if (!question) {
    return (
      <p className="mx-auto max-w-2xl px-4 py-8 text-destructive">
        Não foi possível carregar as questões deste simulado.
      </p>
    );
  }

  const currentAnswer = answers[question.id] ?? { selectedAnswer: null, markedForReview: false };

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <p className="font-medium">
          {data.mode === "fiel" ? `ENEM ${data.examYear}` : "Mesclado"} — Dia {data.examDay}
        </p>
        <p
          className={`font-mono text-sm ${
            remainingSeconds !== null && remainingSeconds < 0 ? "text-destructive" : ""
          }`}
        >
          {remainingSeconds !== null ? formatTime(remainingSeconds) : "--:--:--"}
        </p>
      </div>

      <div className="grid grid-cols-10 gap-1">
        {data.questions.map((q, index) => {
          const a = answers[q.id];
          const isCurrent = index === currentIndex;
          let variant: "default" | "outline" | "secondary" = "outline";
          if (isCurrent) variant = "default";
          else if (a?.selectedAnswer) variant = "secondary";
          return (
            <Button
              key={q.id}
              type="button"
              size="sm"
              variant={variant}
              className={a?.markedForReview && !isCurrent ? "ring-2 ring-yellow-500" : ""}
              onClick={() => setCurrentIndex(index)}
            >
              {index + 1}
            </Button>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">
            Questão {currentIndex + 1} de {data.questions.length} — {question.topic.name}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p>{question.statement}</p>
          {question.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={question.imageUrl}
              alt="Figura da questão"
              className="max-w-sm rounded border"
            />
          )}
          <div className="flex flex-col gap-2">
            {question.alternatives.map((alt) => (
              <Button
                key={alt.letter}
                type="button"
                variant={currentAnswer.selectedAnswer === alt.letter ? "default" : "outline"}
                className="justify-start"
                onClick={() => saveAnswer(question.id, { selectedAnswer: alt.letter })}
              >
                {alt.letter}) {alt.text}
              </Button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                saveAnswer(question.id, { markedForReview: !currentAnswer.markedForReview })
              }
            >
              {currentAnswer.markedForReview ? "Remover marcação" : "Marcar pra revisar"}
            </Button>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((i) => i - 1)}
              >
                Anterior
              </Button>
              {currentIndex + 1 < data.questions.length ? (
                <Button type="button" onClick={() => setCurrentIndex((i) => i + 1)}>
                  Próxima
                </Button>
              ) : null}
              <Button type="button" disabled={finalizing} onClick={handleFinalizar}>
                Finalizar simulado
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
