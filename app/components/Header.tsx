"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { REDACAO_ENABLED, PLANOS_ENABLED } from "@/lib/feature-flags";

export function Header() {
  const router = useRouter();
  const { data, isPending } = authClient.useSession();
  const [plan, setPlan] = useState<"free" | "premium" | null>(null);
  const displayedPlan = data?.user ? plan : null;

  useEffect(() => {
    if (!data?.user) return;
    let cancelled = false;
    fetch("/api/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled && body) setPlan(body.plan);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [data?.user]);

  async function handleSignOut() {
    try {
      await authClient.signOut();
      router.push("/");
      router.refresh();
    } catch (error) {
      console.error("Erro ao sair:", error);
    }
  }

  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <Link href="/" className="font-semibold">
        Plataforma ENEM
      </Link>

      {isPending ? null : data?.user ? (
        <div className="flex items-center gap-3 text-sm">
          <Button render={<Link href="/pratica">Praticar</Link>} variant="link" />
          <Button render={<Link href="/simulados">Simulados</Link>} variant="link" />
          {REDACAO_ENABLED && (
            <Button render={<Link href="/redacao">Redação</Link>} variant="link" />
          )}
          {PLANOS_ENABLED &&
            (displayedPlan === "premium" ? (
              <Link
                href="/planos"
                className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
              >
                Premium
              </Link>
            ) : (
              <Button render={<Link href="/planos">Planos</Link>} variant="link" />
            ))}
          <span>{data.user.name}</span>
          <Button type="button" variant="outline" size="sm" onClick={handleSignOut}>
            Sair
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-sm">
          {PLANOS_ENABLED && (
            <Button render={<Link href="/planos">Planos</Link>} variant="link" />
          )}
          <Button render={<Link href="/entrar">Entrar</Link>} variant="link" />
        </div>
      )}
    </header>
  );
}
