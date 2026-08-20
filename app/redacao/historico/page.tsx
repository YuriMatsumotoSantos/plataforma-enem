"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

type RedacaoResumo = {
  id: string;
  temaTitle: string;
  notaTotal: number;
  createdAt: string;
};

function HistoricoContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = Number(searchParams.get("page") ?? "1") || 1;

  const [redacoes, setRedacoes] = useState<RedacaoResumo[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/redacao/redacoes?page=${page}`)
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar histórico. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || data === null) return;
        setRedacoes(data.redacoes);
        setTotal(data.total);
        setPageSize(data.pageSize);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [router, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Meu histórico de redações</h1>

      {error && <p className="text-destructive">{error}</p>}
      {!redacoes && !error && <p>Carregando...</p>}
      {redacoes && redacoes.length === 0 && (
        <p className="text-muted-foreground">Você ainda não escreveu nenhuma redação.</p>
      )}

      {redacoes && redacoes.length > 0 && (
        <div className="flex flex-col gap-3">
          {redacoes.map((r) => (
            <Link key={r.id} href={`/redacao/resultado/${r.id}`}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <p className="font-medium">{r.temaTitle}</p>
                  <div className="flex flex-col items-end gap-1">
                    <p className="text-sm text-muted-foreground">{r.notaTotal} / 1000</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {redacoes && totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href={`/redacao/historico?page=${Math.max(1, page - 1)}`} text="Anterior" />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink href={`/redacao/historico?page=${p}`} isActive={p === page}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext href={`/redacao/historico?page=${Math.min(totalPages, page + 1)}`} text="Próxima" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </main>
  );
}

export default function HistoricoPage() {
  return (
    <Suspense fallback={<p className="px-4 py-8">Carregando...</p>}>
      <HistoricoContent />
    </Suspense>
  );
}
