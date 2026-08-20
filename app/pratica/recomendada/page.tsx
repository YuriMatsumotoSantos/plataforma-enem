"use client";

import { PracticeRunner } from "@/app/pratica/PracticeRunner";

export default function PraticaRecomendadaPage() {
  return (
    <PracticeRunner
      questionsUrl="/api/practice/recommended"
      backHref="/dashboard"
      backLabel="Dashboard"
      emptyMessage="Nenhuma questão disponível pra sessão recomendada agora."
    />
  );
}
