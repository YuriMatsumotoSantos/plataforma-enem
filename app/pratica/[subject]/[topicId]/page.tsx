"use client";

import { useParams } from "next/navigation";
import { PracticeRunner } from "@/app/pratica/PracticeRunner";

export default function PraticaSessaoPage() {
  const params = useParams<{ subject: string; topicId: string }>();
  const subject = decodeURIComponent(params.subject);
  const { topicId } = params;

  return (
    <PracticeRunner
      questionsUrl={`/api/practice/questions?topicId=${encodeURIComponent(topicId)}`}
      backHref={`/pratica/${encodeURIComponent(subject)}`}
      backLabel="Voltar aos assuntos"
      summaryLabel="Voltar aos assuntos"
      emptyMessage="Nenhuma questão disponível ainda para este assunto."
      errorMessage="Erro ao carregar questões. Tente novamente."
    />
  );
}
