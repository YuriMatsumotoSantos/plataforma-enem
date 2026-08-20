"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

type TopicSummary = {
  topicId: string;
  subject: string;
  area: string;
  name: string;
};

type DashboardData = {
  vencidos: TopicSummary[];
  fracos: TopicSummary[];
};

function TopicList({ title, empty, items }: { title: string; empty: string; items: TopicSummary[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((topic) => (
            <Link key={topic.topicId} href={`/pratica/${encodeURIComponent(topic.subject)}/${topic.topicId}`}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between py-3">
                  <p className="font-medium">{topic.name}</p>
                  <p className="text-sm text-muted-foreground">{topic.subject}</p>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard")
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar seu progresso. Tente novamente.");
        }
        return response.json();
      })
      .then((body) => {
        if (cancelled || body === null) return;
        setData(body);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return <p className="mx-auto max-w-2xl px-4 py-8 text-destructive">{error}</p>;
  }

  if (!data) {
    return <p className="mx-auto max-w-2xl px-4 py-8">Carregando...</p>;
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <p className="font-medium">Sessão recomendada</p>
          <p className="text-sm text-muted-foreground">
            Uma sessão com os assuntos que mais precisam da sua atenção agora.
          </p>
          <Button render={<Link href="/pratica/recomendada" />}>Começar sessão recomendada</Button>
        </CardHeader>
      </Card>

      <TopicList title="Assuntos vencidos" empty="Nenhum assunto vencido agora." items={data.vencidos} />
      <TopicList title="Pontos fracos" empty="Nenhum ponto fraco identificado ainda." items={data.fracos} />
    </main>
  );
}
