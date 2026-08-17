"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { EditQuestionDialog } from "./EditQuestionDialog";

export type Alternative = { letter: string; text: string };

export type Topic = { id: string; area: string; subject: string; name: string };

export type Question = {
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
  topic: Topic;
};

const PAGE_SIZE = 20;

function RevisaoContent() {
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/questions?status=pendente&page=${page}`)
      .then((response) => {
        if (response.status === 401) {
          throw new Error("Não autorizado — faça login com uma conta admin.");
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar questões. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setQuestions(data.questions);
        setTotal(data.total);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  async function handleAction(id: string, status: "aprovada" | "rejeitada") {
    const response = await fetch(`/api/admin/questions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (response.ok) {
      setQuestions((prev) => (prev ? prev.filter((q) => q.id !== id) : prev));
      setTotal((prev) => prev - 1);
      setActionError(null);
    } else {
      setActionError("Erro ao processar ação. Tente novamente.");
    }
  }

  function handleEdited(updated: Question) {
    setQuestions((prev) =>
      prev ? prev.map((q) => (q.id === updated.id ? updated : q)) : prev
    );
    setEditingQuestion(null);
  }

  if (error) {
    return <p className="p-8 text-destructive">{error}</p>;
  }

  if (!questions) {
    return <p className="p-8">Carregando...</p>;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Revisão de questões ({total} pendentes)</h1>

      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {questions.length === 0 && (
        <p className="text-muted-foreground">Nenhuma questão pendente de revisão.</p>
      )}

      <div className="flex flex-col gap-4">
        {questions.map((question) => (
          <Card key={question.id}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {question.year} — Dia {question.examDay} — Questão {question.questionNumber}
                </p>
                <p className="text-sm text-muted-foreground">
                  {question.topic.subject} — {question.topic.name}
                </p>
              </div>
              <Badge variant="secondary">{question.status}</Badge>
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
              <ul className="flex flex-col gap-1">
                {question.alternatives.map((alt) => (
                  <li
                    key={alt.letter}
                    className={
                      alt.letter === question.correctAnswer
                        ? "font-medium text-primary"
                        : undefined
                    }
                  >
                    {alt.letter}) {alt.text}
                    {alt.letter === question.correctAnswer && " ✓"}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button onClick={() => handleAction(question.id, "aprovada")}>Aprovar</Button>
                <Button
                  variant="destructive"
                  onClick={() => handleAction(question.id, "rejeitada")}
                >
                  Rejeitar
                </Button>
                <Button variant="outline" onClick={() => setEditingQuestion(question)}>
                  Editar
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href={`/admin/revisao?page=${Math.max(1, page - 1)}`}
                aria-disabled={page === 1}
                className={page === 1 ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
              <PaginationItem key={pageNumber}>
                <PaginationLink
                  href={`/admin/revisao?page=${pageNumber}`}
                  isActive={pageNumber === page}
                >
                  {pageNumber}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                href={`/admin/revisao?page=${Math.min(totalPages, page + 1)}`}
                aria-disabled={page === totalPages}
                className={
                  page === totalPages ? "pointer-events-none opacity-50" : undefined
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      {editingQuestion && (
        <EditQuestionDialog
          question={editingQuestion}
          onClose={() => setEditingQuestion(null)}
          onSaved={handleEdited}
        />
      )}
    </main>
  );
}

export default function RevisaoPage() {
  return (
    <Suspense fallback={<p className="p-8">Carregando...</p>}>
      <RevisaoContent />
    </Suspense>
  );
}
