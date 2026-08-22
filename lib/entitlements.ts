import { and, eq, gte, count } from "drizzle-orm";
import { db, type Database } from "@/lib/db";
import { subscriptions, attempts, simulados, redacoes } from "@/db/schema";

export type Plan = "free" | "premium";

const DAILY_PRACTICE_LIMIT = 20;
const FREE_SIMULADO_LIMIT = 1;
const FREE_REDACAO_MONTHLY_LIMIT = 1;
const PREMIUM_REDACAO_MONTHLY_LIMIT = 20;

function startOfDay(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getUserPlan(
  userId: string,
  dbClient: Omit<Database, "$client"> = db
): Promise<Plan> {
  const [row] = await dbClient
    .select({ status: subscriptions.status, currentPeriodEnd: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));

  if (!row) return "free";

  const isActiveStatus = row.status === "active" || row.status === "trialing";
  const isWithinPeriod = row.currentPeriodEnd.getTime() > Date.now();
  return isActiveStatus && isWithinPeriod ? "premium" : "free";
}

export async function canPracticeToday(userId: string): Promise<boolean> {
  if ((await getUserPlan(userId)) === "premium") return true;

  const [{ value }] = await db
    .select({ value: count() })
    .from(attempts)
    .where(and(eq(attempts.userId, userId), gte(attempts.createdAt, startOfDay())));

  return value < DAILY_PRACTICE_LIMIT;
}

export async function canStartSimulado(userId: string): Promise<boolean> {
  if ((await getUserPlan(userId)) === "premium") return true;

  const [{ value }] = await db
    .select({ value: count() })
    .from(simulados)
    .where(eq(simulados.userId, userId));

  return value < FREE_SIMULADO_LIMIT;
}

// dbClient aceita tanto o db do módulo quanto uma transação (o retorno de
// db.transaction((tx) => ...) não tem a propriedade $client de Database, daí
// o Omit) — permite passar a mesma tx que segura o advisory lock em
// app/api/redacao/redacoes/route.ts, para que a contagem enxergue
// exatamente o estado daquela transação. Chamadas fora de uma transação
// (practice/simulados) continuam usando o db do módulo.
export async function canSubmitRedacao(
  userId: string,
  dbClient: Omit<Database, "$client"> = db
): Promise<boolean> {
  const plan = await getUserPlan(userId, dbClient);
  const limit = plan === "premium" ? PREMIUM_REDACAO_MONTHLY_LIMIT : FREE_REDACAO_MONTHLY_LIMIT;

  const [{ value }] = await dbClient
    .select({ value: count() })
    .from(redacoes)
    .where(and(eq(redacoes.userId, userId), gte(redacoes.createdAt, startOfMonth())));

  return value < limit;
}
