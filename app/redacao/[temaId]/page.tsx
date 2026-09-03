"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const MIN_WORDS = 50;
const MAX_CHARS = 3000;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Thrown for API-level failures whose message is already Portuguese and safe to show as-is. */
class ApiError extends Error {}

export default function EscreverRedacaoPage() {
  const params = useParams<{ temaId: string }>();
  const router = useRouter();
  const [temaTitle, setTemaTitle] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/redacao/temas")
      .then((response) => {
        if (response.status === 401) {
          router.push("/entrar");
          return null;
        }
        return response.json();
      })
      .then((data: { temas: { id: string; title: string }[] } | null) => {
        if (cancelled || data === null) return;
        const tema = data.temas.find((t) => t.id === params.temaId);
        setTemaTitle(tema ? tema.title : null);
      })
      .catch(() => {
        if (!cancelled) setError("Erro ao carregar tema. Tente novamente.");
      });
    return () => {
      cancelled = true;
    };
  }, [router, params.temaId]);

  const wordCount = countWords(text);
  const canSubmit = wordCount >= MIN_WORDS && text.length <= MAX_CHARS && !submitting;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    setLimitReached(false);
    try {
      const response = await fetch("/api/redacao/redacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temaId: params.temaId, text }),
      });
      if (response.status === 402) {
        const body = (await response
          .json()
          .catch(() => ({ error: "Limite do plano grátis atingido." }))) as { error?: string };
        setLimitReached(true);
        throw new ApiError(body.error ?? "Limite do plano grátis atingido.");
      }
      if (!response.ok) {
        const body = (await response
          .json()
          .catch(() => ({ error: "Erro ao corrigir a redação." }))) as { error?: string };
        throw new ApiError(body.error ?? "Erro ao corrigir a redação.");
      }
      const redacao = (await response.json()) as { id: string };
      router.push(`/redacao/resultado/${redacao.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao corrigir a redação.");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">{temaTitle ?? "Carregando tema..."}</h1>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Escreva sua redação aqui..."
        rows={20}
        disabled={submitting}
      />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {wordCount} palavra{wordCount === 1 ? "" : "s"} (mínimo {MIN_WORDS})
        </span>
        <span>
          {text.length} / {MAX_CHARS} caracteres
        </span>
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {limitReached && (
        <Link href="/planos" className="text-sm underline">
          Ver planos
        </Link>
      )}

      <Button
        type="button"
        onClick={() => {
          void handleSubmit();
        }}
        disabled={!canSubmit}
      >
        {submitting ? "Corrigindo... isso pode levar alguns segundos" : "Enviar para correção"}
      </Button>
    </main>
  );
}
