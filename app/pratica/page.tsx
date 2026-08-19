"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";

type Subject = { subject: string; area: string; count: number };

export default function PraticaPage() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/practice/subjects")
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar matérias. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || data === null) return;
        setSubjects(data.subjects);
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
      <h1 className="text-2xl font-semibold">Prática por assunto</h1>

      {error && <p className="text-destructive">{error}</p>}
      {!subjects && !error && <p>Carregando...</p>}
      {subjects && subjects.length === 0 && (
        <p className="text-muted-foreground">Nenhuma questão disponível para prática ainda.</p>
      )}

      {subjects && subjects.length > 0 && (
        <div className="flex flex-col gap-3">
          {subjects.map((s) => (
            <Link key={s.subject} href={`/pratica/${encodeURIComponent(s.subject)}`}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <p className="font-medium">{s.subject}</p>
                  <p className="text-sm text-muted-foreground">{s.count} questões</p>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
