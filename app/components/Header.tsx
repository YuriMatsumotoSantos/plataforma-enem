"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function Header() {
  const router = useRouter();
  const { data, isPending } = authClient.useSession();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <Link href="/" className="font-semibold">
        Plataforma ENEM
      </Link>

      {isPending ? null : data?.user ? (
        <div className="flex items-center gap-3 text-sm">
          <span>{data.user.name}</span>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded border border-zinc-300 px-3 py-1 dark:border-zinc-700"
          >
            Sair
          </button>
        </div>
      ) : (
        <Link href="/entrar" className="text-sm underline">
          Entrar
        </Link>
      )}
    </header>
  );
}
