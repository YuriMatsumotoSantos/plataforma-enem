"use client";

import { useEffect, useState } from "react";

type Alternative = { letter: string; text: string };

type Question = {
  id: string;
  year: number;
  examDay: number;
  questionNumber: number;
  area: string;
  statement: string;
  alternatives: Alternative[];
  correctAnswer: string;
  imageUrl: string | null;
  status: string;
  topic: { id: string; area: string; subject: string; name: string };
};

export default function RevisaoPage() {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/questions?status=pendente")
      .then((response) => {
        if (response.status === 401) {
          throw new Error("Não autorizado — faça login com uma conta admin.");
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar questões. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => setQuestions(data.questions))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function handleAction(id: string, status: "aprovada" | "rejeitada") {
    const response = await fetch(`/api/admin/questions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (response.ok) {
      setQuestions((prev) => (prev ? prev.filter((q) => q.id !== id) : prev));
    } else {
      setError("Erro ao processar ação. Tente novamente.");
    }
  }

  if (error) {
    return <p>{error}</p>;
  }

  if (!questions) {
    return <p>Carregando...</p>;
  }

  if (questions.length === 0) {
    return <p>Nenhuma questão pendente de revisão.</p>;
  }

  return (
    <main>
      <h1>Revisão de questões ({questions.length} pendentes)</h1>
      {questions.map((question) => (
        <article key={question.id} style={{ border: "1px solid #ccc", padding: 16, marginBottom: 16 }}>
          <p>
            <strong>
              {question.year} — Dia {question.examDay} — Questão {question.questionNumber}
            </strong>{" "}
            ({question.topic.subject} — {question.topic.name})
          </p>
          <p>{question.statement}</p>
          {question.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={question.imageUrl} alt="Figura da questão" style={{ maxWidth: 400 }} />
          )}
          <ul>
            {question.alternatives.map((alt) => (
              <li key={alt.letter}>
                {alt.letter}) {alt.text}
                {alt.letter === question.correctAnswer && " ✓"}
              </li>
            ))}
          </ul>
          <button onClick={() => handleAction(question.id, "aprovada")}>Aprovar</button>{" "}
          <button onClick={() => handleAction(question.id, "rejeitada")}>Rejeitar</button>
        </article>
      ))}
    </main>
  );
}
