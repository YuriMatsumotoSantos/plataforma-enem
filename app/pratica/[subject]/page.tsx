"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";

type Topic = { id: string; name: string; count: number };

export default function AssuntoListPage() {
  const params = useParams<{ subject: string }>();
  const router = useRouter();
  const subject = decodeURIComponent(params.subject);

  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/practice/topics?subject=${encodeURIComponent(subject)}`)
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar assuntos. Tente novamente.");
        }
        return response.json();
      })
      .then((data: { topics: Topic[] } | null) => {
        if (cancelled || data === null) return;
        setTopics(data.topics);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [subject, router]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <Link href="/pratica" className="text-sm text-muted-foreground underline">
          ← Matérias
        </Link>
        <h1 className="text-2xl font-semibold">{subject}</h1>
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!topics && !error && <p>Carregando...</p>}
      {topics && topics.length === 0 && (
        <p className="text-muted-foreground">Nenhum assunto disponível para prática ainda.</p>
      )}

      {topics && topics.length > 0 && (
        <div className="flex flex-col gap-3">
          {topics.map((t) => (
            <Link key={t.id} href={`/pratica/${encodeURIComponent(subject)}/${t.id}`}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <p className="font-medium">{t.name}</p>
                  <p className="text-sm text-muted-foreground">{t.count} questões</p>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
