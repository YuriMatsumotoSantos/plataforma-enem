import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { subscriptions } from "@/db/schema";

const VALID_STATUSES = ["trialing", "active", "past_due", "canceled", "incomplete"] as const;
type SubscriptionStatus = (typeof VALID_STATUSES)[number];

function toSubscriptionStatus(status: string): SubscriptionStatus {
  return (VALID_STATUSES as readonly string[]).includes(status)
    ? (status as SubscriptionStatus)
    : "incomplete";
}

async function upsertSubscription(sub: Stripe.Subscription, eventId: string) {
  if (sub.items.data.length === 0) {
    logger.error("Webhook: subscription sem items.data, evento ignorado", {
      eventId,
      subscriptionId: sub.id,
    });
    return;
  }

  const currentPeriodEnd = new Date(sub.items.data[0].current_period_end * 1000);
  const status = toSubscriptionStatus(sub.status);
  const userId = sub.metadata?.userId;
  const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  if (userId) {
    // Identidade é o userId (subscriptions.userId é UNIQUE — um plano por
    // usuário). Um novo stripeSubscriptionId (ex: reassinatura após cancelar)
    // substitui a linha existente do usuário em vez de tentar inserir uma
    // segunda linha e violar a constraint.
    await db
      .insert(subscriptions)
      .values({
        id: crypto.randomUUID(),
        userId,
        stripeCustomerId,
        stripeSubscriptionId: sub.id,
        status,
        currentPeriodEnd,
      })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: { stripeCustomerId, stripeSubscriptionId: sub.id, status, currentPeriodEnd },
      });
    return;
  }

  // Sem metadata.userId (ex: evento updated/deleted posterior de uma
  // assinatura cuja linha já foi criada pelo evento created). Atualiza pela
  // stripeSubscriptionId; se não houver linha correspondente, não há o que
  // atualizar.
  const updated = await db
    .update(subscriptions)
    .set({ status, currentPeriodEnd })
    .where(eq(subscriptions.stripeSubscriptionId, sub.id))
    .returning({ id: subscriptions.id });

  if (updated.length === 0) {
    logger.error("Webhook: sem metadata.userId e sem linha existente para atualizar", {
      eventId,
      subscriptionId: sub.id,
    });
  }
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json({ error: "Webhook não configurado" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();
  const stripe = getStripeClient();

  let event: Stripe.Event;
  try {
    if (!signature) throw new Error("Assinatura ausente");
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return Response.json({ error: "Assinatura inválida" }, { status: 400 });
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated"
  ) {
    await upsertSubscription(event.data.object as Stripe.Subscription, event.id);
  } else if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    await db
      .update(subscriptions)
      .set({ status: "canceled" })
      .where(eq(subscriptions.stripeSubscriptionId, sub.id));
  }

  return Response.json({ received: true });
}
