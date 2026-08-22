import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";
import { db } from "@/lib/db";
import { subscriptions } from "@/db/schema";

const VALID_STATUSES = ["trialing", "active", "past_due", "canceled", "incomplete"] as const;
type SubscriptionStatus = (typeof VALID_STATUSES)[number];

function toSubscriptionStatus(status: string): SubscriptionStatus {
  return (VALID_STATUSES as readonly string[]).includes(status)
    ? (status as SubscriptionStatus)
    : "incomplete";
}

async function upsertSubscription(sub: Stripe.Subscription) {
  const currentPeriodEnd = new Date(sub.items.data[0].current_period_end * 1000);
  const status = toSubscriptionStatus(sub.status);

  const [existing] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, sub.id));

  if (existing) {
    await db
      .update(subscriptions)
      .set({ status, currentPeriodEnd })
      .where(eq(subscriptions.stripeSubscriptionId, sub.id));
    return;
  }

  const userId = sub.metadata?.userId;
  if (!userId) return;

  await db.insert(subscriptions).values({
    id: crypto.randomUUID(),
    userId,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    status,
    currentPeriodEnd,
  });
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
    await upsertSubscription(event.data.object as Stripe.Subscription);
  } else if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    await db
      .update(subscriptions)
      .set({ status: "canceled" })
      .where(eq(subscriptions.stripeSubscriptionId, sub.id));
  }

  return Response.json({ received: true });
}
