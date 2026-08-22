import { and, eq, gte, count } from "drizzle-orm";
import { db } from "@/lib/db";
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

export async function getUserPlan(userId: string): Promise<Plan> {
  const [row] = await db
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

export async function canSubmitRedacao(userId: string): Promise<boolean> {
  const plan = await getUserPlan(userId);
  const limit = plan === "premium" ? PREMIUM_REDACAO_MONTHLY_LIMIT : FREE_REDACAO_MONTHLY_LIMIT;

  const [{ value }] = await db
    .select({ value: count() })
    .from(redacoes)
    .where(and(eq(redacoes.userId, userId), gte(redacoes.createdAt, startOfMonth())));

  return value < limit;
}
