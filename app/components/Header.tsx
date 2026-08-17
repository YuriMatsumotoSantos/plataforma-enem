"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function Header() {
  const router = useRouter();
  const { data, isPending } = authClient.useSession();

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
          <span>{data.user.name}</span>
          <Button type="button" variant="outline" size="sm" onClick={handleSignOut}>
            Sair
          </Button>
        </div>
      ) : (
        <Button render={<Link href="/entrar">Entrar</Link>} variant="link" />
      )}
    </header>
  );
}
