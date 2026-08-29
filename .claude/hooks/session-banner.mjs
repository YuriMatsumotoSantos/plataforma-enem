#!/usr/bin/env node
// SessionStart hook — injeta um resumo de 1-2 linhas do estado real do
// repo no início da sessão (branch atual, arquivos sujos, worktrees
// abertas). Fail-open total: se qualquer comando git falhar (repo não
// inicializado, git ausente), a sessão começa normalmente, só sem banner.

import { execSync } from "node:child_process";
import { readStdinRaw, parseHookEvent } from "./hook-io.mjs";

function safe(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function main() {
  // SessionStart não exige um evento JSON útil pra funcionar (não há
  // tool_input pra ler) — mas ainda seguimos o mesmo contrato de leitura
  // segura por consistência com os outros hooks deste projeto.
  parseHookEvent(readStdinRaw());

  const branch = safe("git branch --show-current");
  if (branch === null) {
    process.exit(0); // não é um repo git, ou git ausente — sem banner
  }

  const dirty = safe("git status --porcelain=v1");
  const dirtyCount = dirty ? dirty.split("\n").filter(Boolean).length : 0;
  const worktrees = safe("git worktree list --porcelain");
  const worktreeCount = worktrees
    ? worktrees.split("\n").filter((l) => l.startsWith("worktree ")).length - 1 // -1: exclui o checkout principal
    : 0;

  const parts = [`branch: ${branch}`];
  parts.push(dirtyCount > 0 ? `${dirtyCount} arquivo(s) não commitado(s)` : "working tree limpo");
  if (worktreeCount > 0) parts.push(`${worktreeCount} worktree(s) aberta(s)`);

  console.log(
    JSON.stringify({
      hookSpecificOutput: { additionalContext: `[plataforma-enem] ${parts.join(" — ")}` },
    })
  );
  process.exit(0);
}

try {
  main();
} catch {
  process.exit(0); // qualquer erro não previsto — sessão começa sem banner, nunca trava
}
