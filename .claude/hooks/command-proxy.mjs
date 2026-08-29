#!/usr/bin/env node
// RTK-style token proxy — PreToolUse hook on Bash.
// Pattern from vibe-coding-toolkit/docs/tools/03-rtk-token-proxy.md, built
// from scratch for this project (no external "rtk-proxy" binary exists —
// the compaction logic lives inline here, per that doc's own FAQ: "dá pra
// fazer tudo dentro do hook se a compactação for simples").
//
// ponytail: scope deliberately narrow for v1 — only rewrites the exact
// zero-argument commands `git status` / `git diff` / `git log` (no flags
// at all). Any flag or extra argument falls outside the exact match and
// passes through unrewritten. This sidesteps the "flag collision" pitfall
// the source doc warns about (e.g. `git log -h` being misread as the
// proxy's own help flag) entirely, at the cost of not compacting
// `git diff --stat` or `git log --oneline -n 20` etc. Widen the match in
// rewriteCommand() below if that's worth it later — grep/find/ls are not
// covered yet either, same reason (start narrow, prove it's safe, widen).
//
// Escape hatch: prefix any command with `RTK_RAW=1 ` to bypass rewriting
// entirely, even for an exact-matching command — e.g. `RTK_RAW=1 git status`
// always runs raw. This is the "via de escape sem filtro" the doc insists on
// having before trusting the hook.
//
// Meta commands (never rewritten): `rtk stats`, `rtk history`.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readStdinRaw, parseHookEvent } from "./hook-io.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATS_FILE = join(__dirname, "..", "state", "rtk-stats.json");
const MAX_HISTORY = 200;

function loadStats() {
  try {
    return JSON.parse(readFileSync(STATS_FILE, "utf8"));
  } catch {
    return { entries: [] };
  }
}

function saveStats(stats) {
  try {
    mkdirSync(dirname(STATS_FILE), { recursive: true });
    writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch {
    // Falha ao gravar estatísticas nunca deve bloquear o comando real —
    // fail-open, mesmo pra essa parte "extra" do hook.
  }
}

function record(command, rawLength, summaryLength) {
  const stats = loadStats();
  stats.entries.push({
    ts: new Date().toISOString(),
    command,
    rawBytes: rawLength,
    summaryBytes: summaryLength,
    savedBytes: Math.max(0, rawLength - summaryLength),
  });
  if (stats.entries.length > MAX_HISTORY) {
    stats.entries = stats.entries.slice(-MAX_HISTORY);
  }
  saveStats(stats);
}

function block(reason) {
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function handleMeta(command) {
  if (command === "rtk stats") {
    const stats = loadStats();
    const totalSaved = stats.entries.reduce((sum, e) => sum + e.savedBytes, 0);
    const totalRewrites = stats.entries.length;
    block(
      `RTK — ${totalRewrites} comando(s) reescrito(s), ~${totalSaved} bytes de saída poupados (aproximação: bytes brutos - bytes do resumo, não é a mesma unidade de tokens do modelo, mas correlaciona bem).`
    );
  }
  if (command === "rtk history") {
    const stats = loadStats();
    const last = stats.entries.slice(-10);
    const lines = last.map((e) => `${e.ts} — ${e.command} — poupou ~${e.savedBytes}B`);
    block(lines.length ? lines.join("\n") : "Nenhuma reescrita registrada ainda.");
  }
}

// Cada rewrite* mede o tamanho do comando bruto de verdade (rodando-o uma
// vez) além de montar o resumo. Isso não custa nenhum token — o conteúdo
// bruto nunca é mostrado ao agente, só o `.length` dele é usado — então
// não há razão pra estimar/chutar quando dá pra medir de verdade. `rtk
// stats` só tem valor se o número for real.

function rewriteGitStatus() {
  const branch = execSync("git branch --show-current", { encoding: "utf8" }).trim();
  const porcelain = execSync("git status --porcelain=v1", { encoding: "utf8" });
  const rawLength = execSync("git status", { encoding: "utf8" }).length;
  const lines = porcelain.split("\n").filter(Boolean);
  const staged = lines.filter((l) => l[0] !== " " && l[0] !== "?").length;
  const modified = lines.filter((l) => l[1] === "M").length;
  const untracked = lines.filter((l) => l.startsWith("??")).length;
  const summary = `branch: ${branch} — ${staged} staged, ${modified} modificado(s), ${untracked} novo(s) (rtk raw: RTK_RAW=1 git status)`;
  return { summary, rawLength };
}

function rewriteGitDiff() {
  const stat = execSync("git diff --stat", { encoding: "utf8" }).trim();
  const rawLength = execSync("git diff", { encoding: "utf8" }).length;
  const summary = stat
    ? `${stat.split("\n").pop()} (rtk raw: RTK_RAW=1 git diff, pra ver o diff completo)`
    : "sem diferenças no working tree (rtk raw: RTK_RAW=1 git diff)";
  return { summary, rawLength };
}

function rewriteGitLog() {
  const count = execSync("git rev-list --count HEAD", { encoding: "utf8" }).trim();
  const last = execSync("git log --oneline -n 10", { encoding: "utf8" }).trim();
  const rawLength = execSync("git log", { encoding: "utf8" }).length;
  const summary = `${count} commit(s) no total. Últimos 10:\n${last}\n(rtk raw: RTK_RAW=1 git log, pro log completo)`;
  return { summary, rawLength };
}

function rewriteCommand(command) {
  switch (command) {
    case "git status":
      return rewriteGitStatus();
    case "git diff":
      return rewriteGitDiff();
    case "git log":
      return rewriteGitLog();
    default:
      return null;
  }
}

function main() {
  const evento = parseHookEvent(readStdinRaw());
  if (evento === null) {
    process.exit(0); // falha aberta — sem evento utilizável
  }

  const rawCommand = evento?.tool_input?.command ?? "";
  const command = rawCommand.trim();

  if (command.startsWith("rtk ")) {
    handleMeta(command);
    process.exit(0); // comando rtk desconhecido — deixa passar (viraria erro de shell, visível)
  }

  if (command.startsWith("RTK_RAW=1 ")) {
    process.exit(0); // via de escape — roda cru, sem reescrita
  }

  let rewritten;
  try {
    rewritten = rewriteCommand(command);
  } catch {
    process.exit(0); // qualquer erro na reescrita — falha aberta, comando original roda
  }

  if (rewritten === null) {
    process.exit(0); // não é um dos 3 comandos exatos reescrevíveis — roda sem alteração
  }

  record(command, rewritten.rawLength, rewritten.summary.length);
  block(rewritten.summary);
}

try {
  main();
} catch {
  process.exit(0); // qualquer bug não previsto no hook inteiro — nunca trava a sessão
}
