"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Tema = { id: string; title: string };

export default function RedacaoPage() {
  const router = useRouter();
  const [temas, setTemas] = useState<Tema[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/redacao/temas")
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar temas. Tente novamente.");
        }
        return response.json();
      })
      .then((data: { temas: Tema[] } | null) => {
        if (cancelled || data === null) return;
        setTemas(data.temas);
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
        <h1 className="text-2xl font-semibold">Redação</h1>
        <Button render={<Link href="/redacao/historico">Meu histórico</Link>} variant="link" />
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!temas && !error && <p>Carregando...</p>}
      {temas && temas.length === 0 && (
        <p className="text-muted-foreground">Nenhum tema disponível ainda.</p>
      )}

      {temas && temas.length > 0 && (
        <div className="flex flex-col gap-3">
          {temas.map((tema) => (
            <Link key={tema.id} href={`/redacao/${tema.id}`}>
              <Card>
                <CardHeader>
                  <p className="font-medium">{tema.title}</p>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
