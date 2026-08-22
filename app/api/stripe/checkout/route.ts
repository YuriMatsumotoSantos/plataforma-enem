import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getStripeClient } from "@/lib/stripe";
import { db } from "@/lib/db";
import { subscriptions } from "@/db/schema";
import { env } from "@/lib/env";
import { getUserPlan } from "@/lib/entitlements";

export async function POST(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const priceId = process.env.STRIPE_PRICE_ID_PREMIUM;
  if (!priceId) {
    return Response.json({ error: "Checkout indisponível no momento" }, { status: 500 });
  }

  if ((await getUserPlan(session.user.id)) === "premium") {
    return Response.json({ error: "Você já tem uma assinatura ativa" }, { status: 400 });
  }

  const [existing] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, session.user.id));

  const stripe = getStripeClient();
  const appUrl = env.NEXT_PUBLIC_APP_URL;

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/planos?sucesso=1`,
    cancel_url: `${appUrl}/planos`,
    customer: existing?.stripeCustomerId,
    customer_email: existing ? undefined : session.user.email,
    subscription_data: { metadata: { userId: session.user.id } },
  });

  if (!checkoutSession.url) {
    return Response.json({ error: "Não foi possível iniciar o checkout" }, { status: 502 });
  }

  return Response.json({ url: checkoutSession.url });
}
