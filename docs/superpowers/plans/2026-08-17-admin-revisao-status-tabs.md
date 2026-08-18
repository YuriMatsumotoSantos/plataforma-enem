# Abas de status em /admin/revisao Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Pendentes/Aprovadas/Rejeitadas tabs to `/admin/revisao`, so the admin can review and correct decisions on questions of any status, not just pending ones.

**Architecture:** Pure frontend change to the existing Client Component `app/admin/revisao/page.tsx`. The active status lives in the URL (`?status=X&page=N`), read via `useSearchParams()`, exactly like the existing `page` param. No new API route — the existing `GET /api/admin/questions?status=X&page=Y` already validates and serves all three statuses; only the frontend was hardcoded to `status=pendente`.

**Tech Stack:** Next.js 16 (App Router, Client Components), React 19, existing shadcn/ui `Button` component (Base UI-based, not Radix).

## Global Constraints

- No new API routes, no schema changes — spec confirms this is frontend-only (`docs/superpowers/specs/2026-08-17-admin-revisao-status-tabs-design.md`).
- Approve/Reject/Editar buttons must remain available regardless of which status tab is active.
- Switching tabs must reset pagination to page 1.
- This project's shadcn install is Base UI-based, not classic Radix — `Button` has no `asChild` prop; use `render={<Link .../>}` instead (already the established pattern in `app/components/Header.tsx`).
- `npx tsc --noEmit` must be run AFTER `npx next build`, never before — this project's CI order exists because `next build` generates `.next/types` that some pages depend on for typecheck to pass.
- No automated test framework exists for this repo's Client Components (only `vitest` against real Postgres for API routes) — this task is verified via real browser interaction, matching the project's established pattern for `/entrar` and the original `/admin/revisao` build. A `curl` request or a DOM-structure-only check does **not** count as verification here: you must actually click each tab, watch the network request in the browser, and confirm the rendered list/count changes.

---

### Task 1: Add status tabs to `/admin/revisao`

**Files:**
- Modify: `app/admin/revisao/page.tsx` (full file — every function in it is touched)

**Interfaces:**
- Consumes: `GET /api/admin/questions?status=X&page=Y` (existing, unchanged) → `{ questions: Question[], total: number, page: number, pageSize: number }`. `status` accepts `"pendente" | "aprovada" | "rejeitada"`.
- Consumes: `PATCH /api/admin/questions/:id` (existing, unchanged) → body `{ status: "aprovada" | "rejeitada" }`, returns the updated question.
- Produces: nothing consumed by other tasks — this is a leaf UI change.

- [ ] **Step 1: Replace the full contents of `app/admin/revisao/page.tsx`**

Replace the entire file with:

```tsx
"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { EditQuestionDialog } from "./EditQuestionDialog";

export type Alternative = { letter: string; text: string };

export type Topic = { id: string; area: string; subject: string; name: string };

export type Question = {
  id: string;
  year: number;
  examDay: number;
  questionNumber: number;
  area: string;
  statement: string;
  alternatives: Alternative[];
  correctAnswer: string;
  imageUrl: string | null;
  status: string;
  topic: Topic;
};

const PAGE_SIZE = 20;

const STATUSES = ["pendente", "aprovada", "rejeitada"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_LABELS: Record<Status, string> = {
  pendente: "Pendentes",
  aprovada: "Aprovadas",
  rejeitada: "Rejeitadas",
};

function isValidStatus(value: string | null): value is Status {
  return STATUSES.some((s) => s === value);
}

function RevisaoContent() {
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const statusParam = searchParams.get("status");
  const status: Status = isValidStatus(statusParam) ? statusParam : "pendente";

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<Status, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  const fetchCounts = useCallback(async () => {
    const results = await Promise.all(
      STATUSES.map((s) =>
        fetch(`/api/admin/questions?status=${s}&page=1`)
          .then((response) => (response.ok ? response.json() : { total: 0 }))
          .catch(() => ({ total: 0 }))
      )
    );
    const next = {} as Record<Status, number>;
    STATUSES.forEach((s, index) => {
      next[s] = results[index].total ?? 0;
    });
    setCounts(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/questions?status=${status}&page=${page}`)
      .then((response) => {
        if (response.status === 401) {
          throw new Error("Não autorizado — faça login com uma conta admin.");
        }
        if (!response.ok) {
          throw new Error("Erro ao carregar questões. Tente novamente.");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setQuestions(data.questions);
        setTotal(data.total);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [page, status]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  async function handleAction(id: string, newStatus: "aprovada" | "rejeitada") {
    try {
      const response = await fetch(`/api/admin/questions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) {
        setActionError("Erro ao processar ação. Tente novamente.");
        return;
      }
      setActionError(null);

      const refreshResponse = await fetch(`/api/admin/questions?status=${status}&page=${page}`);
      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        setQuestions(data.questions);
        setTotal(data.total);
      }
      fetchCounts();
    } catch {
      setActionError("Não foi possível conectar. Verifique sua internet e tente novamente.");
    }
  }

  function handleEdited(updated: Question) {
    setQuestions((prev) =>
      prev ? prev.map((q) => (q.id === updated.id ? updated : q)) : prev
    );
    setEditingQuestion(null);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Revisão de questões</h1>
        <div className="flex gap-2">
          {STATUSES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={s === status ? "default" : "outline"}
              render={<Link href={`/admin/revisao?status=${s}&page=1`} />}
            >
              {STATUS_LABELS[s]}
              {counts ? ` (${counts[s]})` : ""}
            </Button>
          ))}
        </div>
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {!questions && !error && <p>Carregando...</p>}

      {questions && questions.length === 0 && (
        <p className="text-muted-foreground">
          Nenhuma questão {STATUS_LABELS[status].toLowerCase()} no momento.
        </p>
      )}

      {questions && questions.length > 0 && (
        <div className="flex flex-col gap-4">
          {questions.map((question) => (
            <Card key={question.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {question.year} — Dia {question.examDay} — Questão {question.questionNumber}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {question.topic.subject} — {question.topic.name}
                  </p>
                </div>
                <Badge variant="secondary">{question.status}</Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p>{question.statement}</p>
                {question.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={question.imageUrl}
                    alt="Figura da questão"
                    className="max-w-sm rounded border"
                  />
                )}
                <ul className="flex flex-col gap-1">
                  {question.alternatives.map((alt) => (
                    <li
                      key={alt.letter}
                      className={
                        alt.letter === question.correctAnswer
                          ? "font-medium text-primary"
                          : undefined
                      }
                    >
                      {alt.letter}) {alt.text}
                      {alt.letter === question.correctAnswer && " ✓"}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button onClick={() => handleAction(question.id, "aprovada")}>Aprovar</Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleAction(question.id, "rejeitada")}
                  >
                    Rejeitar
                  </Button>
                  <Button variant="outline" onClick={() => setEditingQuestion(question)}>
                    Editar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {questions && totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href={`/admin/revisao?status=${status}&page=${Math.max(1, page - 1)}`}
                aria-disabled={page === 1}
                className={page === 1 ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
              <PaginationItem key={pageNumber}>
                <PaginationLink
                  href={`/admin/revisao?status=${status}&page=${pageNumber}`}
                  isActive={pageNumber === page}
                >
                  {pageNumber}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                href={`/admin/revisao?status=${status}&page=${Math.min(totalPages, page + 1)}`}
                aria-disabled={page === totalPages}
                className={
                  page === totalPages ? "pointer-events-none opacity-50" : undefined
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      {editingQuestion && (
        <EditQuestionDialog
          question={editingQuestion}
          onClose={() => setEditingQuestion(null)}
          onSaved={handleEdited}
        />
      )}
    </main>
  );
}

export default function RevisaoPage() {
  return (
    <Suspense fallback={<p className="p-8">Carregando...</p>}>
      <RevisaoContent />
    </Suspense>
  );
}
```

Key changes from the current file, for review context:
- `status` is now read from the URL (`?status=`), defaulting to and falling back to `"pendente"` for any missing/invalid value via `isValidStatus`.
- The early-return pattern (`if (error) return ...; if (!questions) return ...;`) is replaced with conditional blocks inside one `return`, specifically so the status pills always render even while loading or on error — otherwise an admin who hits an error on the "Aprovadas" tab would have no visible way to click back to "Pendentes".
- New `fetchCounts()` (via `useCallback` so it has a stable identity for the `useEffect` dependency array) fetches all three statuses' `total` in parallel and populates the pill badges. Runs once on mount and again after every successful approve/reject, so counts never drift from what the server actually has — same "always refetch from the server after a mutation" principle already established in this file's `handleAction`.
- `handleAction`, the main fetch, and both count sources all use the current `status` instead of the hardcoded `"pendente"` string.
- Pagination links now carry `&status=${status}` so page navigation doesn't silently reset the active tab.

- [ ] **Step 2: Run lint**

```bash
cd "plataforma-enem" && npm run lint
```
Expected: no errors.

- [ ] **Step 3: Run build, then typecheck (in this exact order)**

```bash
cd "plataforma-enem" && npx next build && npx tsc --noEmit
```
Expected: both succeed with no errors. If `next build` fails specifically on the `Button`/`Link` combination, read the actual generated type at `node_modules/@base-ui/react/tabs` — no, this task doesn't touch `tabs` — read `node_modules/@base-ui/react/... Button`'s prop types and compare against how `app/components/Header.tsx` already uses `render={<Link .../>}`; do not guess, match the working example exactly.

- [ ] **Step 4: Manual verification via real browser interaction**

Start the dev server (`npm run dev`, note the port it actually binds — may not be 3000 if another worktree's server is already running) and open `/admin/revisao` logged in as an admin. Using real browser interaction (Claude_Browser tools or equivalent — **not** `curl`, **not** a DOM-structure-only check):

1. Confirm three pills are visible: "Pendentes (N)", "Aprovadas (N)", "Rejeitadas (N)" with real counts that sum to the total number of 2025 questions in the local DB.
2. Click "Aprovadas" — confirm the URL becomes `/admin/revisao?status=aprovada&page=1`, the list shows approved questions, and the "Aprovadas" pill is now visually active (different `variant`) while the other two are not.
3. On the "Aprovadas" tab, click "Rejeitar" on one question — confirm it disappears from the list, the "Aprovadas" pill count decreases by 1, and the "Rejeitadas" pill count increases by 1 (watch the network tab: this should fire a `PATCH`, then a `GET` for the current page, then three more `GET`s for the counts).
4. Click "Rejeitadas" — confirm the question rejected in step 3 now appears there.
5. If there is more than one page of results on any tab, click page 2, then switch tabs — confirm the tab switch lands on `page=1`, not page 2.
6. Confirm "Editar" still opens the edit dialog correctly from a non-"Pendentes" tab.

Do not report this step as done from reading the code alone — actually perform the 6 checks above in the running browser and note what you observed for each.

- [ ] **Step 5: Commit**

```bash
cd "plataforma-enem" && git add app/admin/revisao/page.tsx && git commit -m "$(cat <<'EOF'
Adiciona abas de status (pendentes/aprovadas/rejeitadas) em /admin/revisao

Permite revisar e corrigir decisões já tomadas, não só questões
pendentes — reaproveita a rota GET /api/admin/questions existente,
que já aceita status como query param.
EOF
)"
```
