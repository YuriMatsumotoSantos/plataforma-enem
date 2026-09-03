"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type Alternative = { letter: string; text: string };

type PracticeQuestion = {
  id: string;
  year: number;
  examDay: number;
  questionNumber: number;
  statement: string;
  alternatives: Alternative[];
  imageUrl: string | null;
  topic: { id: string; area: string; subject: string; name: string };
};

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function PraticaSessaoPage() {
  const params = useParams<{ subject: string; topicId: string }>();
  const router = useRouter();
  const subject = decodeURIComponent(params.subject);
  const { topicId } = params;

  const [questions, setQuestions] = useState<PracticeQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answeredLetter, setAnsweredLetter] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ isCorrect: boolean; correctAnswer: string } | null>(
    null
  );
  const [attemptError, setAttemptError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [score, setScore] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/practice/questions?topicId=${encodeURIComponent(topicId)}`)
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar questões. Tente novamente.");
        }
        return response.json();
      })
      .then((data: { questions: PracticeQuestion[] } | null) => {
        if (cancelled || data === null) return;
        setQuestions(shuffle(data.questions));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [topicId, router]);

  async function handleAnswer(letter: string) {
    if (answeredLetter || !questions) return;
    setAnsweredLetter(letter);
    setAttemptError(null);
    setLimitReached(false);

    try {
      const response = await fetch("/api/practice/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: questions[currentIndex].id,
          selectedAnswer: letter,
        }),
      });

      if (response.status === 401) {
        router.push("/entrar");
        return;
      }

      if (response.status === 402) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setAttemptError(data?.error ?? "Limite do plano grátis atingido.");
        setLimitReached(true);
        return;
      }

      if (!response.ok) {
        setAttemptError("Não foi possível registrar essa resposta, mas você pode continuar.");
        return;
      }

      const data = (await response.json()) as { isCorrect: boolean; correctAnswer: string };
      setFeedback({ isCorrect: data.isCorrect, correctAnswer: data.correctAnswer });
      if (data.isCorrect) setScore((prev) => prev + 1);
    } catch {
      setAttemptError("Não foi possível registrar essa resposta, mas você pode continuar.");
    }
  }

  function handleNext() {
    setAnsweredLetter(null);
    setFeedback(null);
    setAttemptError(null);
    setLimitReached(false);
    setCurrentIndex((prev) => prev + 1);
  }

  if (error) {
    return <p className="mx-auto max-w-2xl px-4 py-8 text-destructive">{error}</p>;
  }

  if (!questions) {
    return <p className="mx-auto max-w-2xl px-4 py-8">Carregando...</p>;
  }

  if (questions.length === 0) {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8">
        <p className="text-muted-foreground">
          Nenhuma questão disponível ainda para este assunto.
        </p>
        <Link href={`/pratica/${encodeURIComponent(subject)}`} className="text-sm underline">
          ← Voltar aos assuntos
        </Link>
      </main>
    );
  }

  if (currentIndex >= questions.length) {
    return (
      <main className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">
          Você acertou {score} de {questions.length}
        </h1>
        <Button render={<Link href={`/pratica/${encodeURIComponent(subject)}`} />}>
          Voltar aos assuntos
        </Button>
      </main>
    );
  }

  const question = questions[currentIndex];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <Link
          href={`/pratica/${encodeURIComponent(subject)}`}
          className="text-sm text-muted-foreground underline"
        >
          ← {question.topic.name}
        </Link>
        <p className="text-sm text-muted-foreground">
          {currentIndex + 1} / {questions.length}
        </p>
      </div>

      {attemptError && <p className="text-sm text-destructive">{attemptError}</p>}
      {limitReached && (
        <Link href="/planos" className="text-sm underline">
          Ver planos
        </Link>
      )}

      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">
            {question.year} — Dia {question.examDay} — Questão {question.questionNumber}
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
            {question.alternatives.map((alt) => {
              const isSelected = answeredLetter === alt.letter;
              const isCorrectAnswer = feedback?.correctAnswer === alt.letter;
              let variant: "default" | "outline" | "destructive" = "outline";
              if (feedback) {
                if (isCorrectAnswer) variant = "default";
                else if (isSelected) variant = "destructive";
              } else if (isSelected) {
                variant = "default";
              }
              return (
                <Button
                  key={alt.letter}
                  type="button"
                  variant={variant}
                  className="justify-start"
                  disabled={answeredLetter !== null}
                  onClick={() => {
                    void handleAnswer(alt.letter);
                  }}
                >
                  {alt.letter}) {alt.text}
                  {feedback && isCorrectAnswer && " ✓"}
                </Button>
              );
            })}
          </div>

          {answeredLetter && (
            <Button onClick={handleNext}>
              {currentIndex + 1 === questions.length ? "Ver resultado" : "Próxima"}
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
